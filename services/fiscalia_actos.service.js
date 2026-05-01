const path = require('path');
const { ensureScreenshotDir } = require('../utils/capturas.util');

const FALLBACK_MODULE_URL =
  'https://www.gestiondefiscalias.gob.ec/siaf/informacion/web/actosadministrativos/index.php';
const RESULTADOS_URL =
  'https://www.gestiondefiscalias.gob.ec/siaf/comunes/actosadministrativos/info_ext.php';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';
const ACTOS_BLOCKED_MESSAGE = 'El proveedor bloqueó temporalmente la consulta de Fiscalía.';
const ACTOS_CAPTURE_CONTAINER_ID = 'codex_fiscalia_actos_capture';

const normalizeText = (value = '') => value.replace(/\s+/g, ' ').trim();

const sanitizeCriteria = (value = '') =>
  normalizeText(value)
    .replace(/[\\"]/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildBusinfo = (criterio) =>
  `a:1:{i:0;s:${Buffer.byteLength(criterio, 'utf8')}:"${criterio}";}`;

const isBlockedHtml = (html = '') =>
  /_Incapsula_Resource|No autorizado, solicite soporte técnico|Request unsuccessful\. Incapsula/i.test(
    html
  );

const buildBlockedData = (criterioBusqueda, mensaje = ACTOS_BLOCKED_MESSAGE) => ({
  consulta: { criterio: criterioBusqueda },
  coincidencias: false,
  total_actos: 0,
  mensaje,
  actos: []
});

const abrirModuloActos = async (page, siteUrl) => {
  await page.goto(siteUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  const iframe = page.locator('iframe#blockrandom, iframe[src*="actosadministrativos"]').first();
  await iframe.waitFor({ state: 'attached', timeout: 30000 }).catch(() => null);

  const iframeSrc = await iframe.getAttribute('src').catch(() => null);
  const targetUrl = iframeSrc || FALLBACK_MODULE_URL;

  await page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => null);
  await page.waitForSelector('#pwd', { timeout: 8000 }).catch(() => null);
};

const ensureActosCaptureScaffold = async (page, criterioBusqueda) => {
  await page.evaluate(({ criterio, containerId }) => {
    const body = document.body || document.documentElement;

    if (!body) return;

    body.style.background = '#ffffff';
    body.style.margin = '0';
    body.style.fontFamily = 'Arial, sans-serif';

    let container = document.getElementById(containerId);

    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      container.style.maxWidth = '1280px';
      container.style.margin = '0 auto';
      container.style.padding = '32px 36px';
      container.style.color = '#111827';
      body.innerHTML = '';
      body.appendChild(container);
    }

    container.innerHTML = `
      <div style="margin-bottom:20px;">
        <div style="font-size:28px;font-weight:700;">Fiscalia General del Estado</div>
        <div style="font-size:18px;color:#374151;margin-top:6px;">Consulta de actos administrativos</div>
      </div>
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">
        <label for="pwd" style="font-weight:700;">Criterio:</label>
        <input
          id="pwd"
          type="text"
          value=""
          style="min-width:320px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px;"
        />
      </div>
      <div id="loading" style="min-height:20px;margin-bottom:12px;"></div>
      <div id="resultados" style="display:block;"></div>
    `;

    const input = document.getElementById('pwd');
    if (input) input.value = criterio;
  }, {
    criterio: criterioBusqueda,
    containerId: ACTOS_CAPTURE_CONTAINER_ID
  });
};

const fetchResultadosHtmlInBrowser = async (page, criterioBusqueda) => {
  const response = await page.evaluate(async ({ criterio }) => {
    const len = new TextEncoder().encode(criterio).length;
    const businfo = `a:1:{i:0;s:${len}:"${criterio}";}`;
    const url = `../../../comunes/actosadministrativos/info_ext.php?businfo=${encodeURIComponent(businfo)}`;

    try {
      const fetchResponse = await fetch(url, {
        credentials: 'include',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      const html = await fetchResponse.text();

      return {
        ok: fetchResponse.ok,
        status: fetchResponse.status,
        html
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        html: '',
        error: error.message || String(error)
      };
    }
  }, {
    criterio: criterioBusqueda
  });

  if (!response.ok) {
    throw new Error(
      response.error
        ? `Fiscalía no respondió correctamente: ${response.error}`
        : `Fiscalía respondió con estado ${response.status}.`
    );
  }

  if (isBlockedHtml(response.html)) {
    throw new Error(ACTOS_BLOCKED_MESSAGE);
  }

  return response.html;
};

const fetchResultadosHtmlDirect = async (criterioBusqueda) => {
  const businfo = buildBusinfo(criterioBusqueda);
  const url = `${RESULTADOS_URL}?businfo=${encodeURIComponent(businfo)}`;

  const response = await fetch(url, {
    headers: {
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Fiscalía respondió con estado ${response.status}.`);
  }

  const html = await response.text();

  if (isBlockedHtml(html)) {
    throw new Error(ACTOS_BLOCKED_MESSAGE);
  }

  return html;
};

const inyectarResultados = async (page, criterioBusqueda, resultadosHtml) => {
  await ensureActosCaptureScaffold(page, criterioBusqueda);

  await page.evaluate(({ criterio, html }) => {
    const input = document.querySelector('#pwd');
    if (input) input.value = criterio;

    const loading = document.querySelector('#loading');
    if (loading) loading.innerHTML = '';

    const resultados = document.querySelector('#resultados');
    if (resultados) {
      resultados.innerHTML = html;
      resultados.style.display = 'block';
    }
  }, {
    criterio: criterioBusqueda,
    html: resultadosHtml
  });
};

const mostrarMensajeActos = async (page, criterioBusqueda, mensaje) => {
  await ensureActosCaptureScaffold(page, criterioBusqueda);

  const safeMessage = mensaje.replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[char]));

  await inyectarResultados(page, criterioBusqueda, `
    <div style="border:1px solid #fecaca;background:#fef2f2;color:#991b1b;padding:18px 20px;border-radius:12px;">
      <div style="font-weight:700;margin-bottom:8px;">Consulta no disponible</div>
      <div>${safeMessage}</div>
    </div>
  `);
};

const extraerDatosActos = async (page, criterioBusqueda) =>
  page.evaluate((criterio) => {
    const normalize = (value = '') => value.replace(/\s+/g, ' ').trim();
    const resultados = document.querySelector('#resultados');

    if (!resultados) {
      return {
        consulta: { criterio },
        coincidencias: false,
        total_actos: 0,
        mensaje: 'No se encontró el bloque de resultados',
        actos: []
      };
    }

    const plainText = normalize(resultados.innerText || '');
    if (/No existen coincidencias para los criterios ingresados/i.test(plainText)) {
      return {
        consulta: { criterio },
        coincidencias: false,
        total_actos: 0,
        mensaje: 'No existen coincidencias para los criterios ingresados',
        actos: []
      };
    }

    const tables = [...resultados.querySelectorAll('table')];
    const actos = tables
      .filter((table) =>
        /ACTO ADMINISTRATIVO NRO\./i.test(
          normalize(table.querySelector('thead th')?.innerText || '')
        )
      )
      .map((table) => {
        const title = normalize(table.querySelector('thead th')?.innerText || '');
        const acto = {
          acto_administrativo: title || null,
          numero_acto: title.replace(/^ACTO ADMINISTRATIVO NRO\.\s*/i, '').trim() || null,
          fecha_hora_registro: null,
          fecha_registro: null,
          hora_registro: null,
          asesor: null,
          cedula_denunciante: null,
          nombre_denunciante: null,
          descripcion: null,
          observaciones: null,
          fiscalia: null,
          id_referencia: null
        };

        const rows = [...table.querySelectorAll('tbody tr')];

        for (const row of rows) {
          const cells = [...row.querySelectorAll('td')];
          const offset = row.querySelector('img') ? 1 : 0;

          for (let index = offset; index < cells.length; index += 2) {
            const label = normalize(cells[index]?.innerText || '').replace(/:$/, '');
            const valueCell = cells[index + 1];
            const value = normalize(valueCell?.innerText || '');

            switch (label.toUpperCase()) {
              case 'FECHA / HORA DE REGISTRO': {
                acto.fecha_hora_registro = value || null;
                const [fechaRegistro, horaRegistro] = value.split('/').map((part) => normalize(part));
                acto.fecha_registro = fechaRegistro || null;
                acto.hora_registro = horaRegistro || null;
                break;
              }
              case 'ASESOR':
                acto.asesor = value || null;
                break;
              case 'CEDULA DENUNCIANTE':
                acto.cedula_denunciante = value || null;
                break;
              case 'NOMBRE DENUNCIANTE':
                acto.nombre_denunciante = value || null;
                break;
              case 'DESCRIPCION':
                acto.descripcion = value || null;
                break;
              case 'OBSERVACIONES':
                acto.observaciones = value || null;
                break;
              case 'FISCALIA':
                acto.fiscalia = value || null;
                break;
              case 'ACCIONES': {
                const onclick = valueCell?.querySelector('input')?.getAttribute('onclick') || '';
                acto.id_referencia = onclick.match(/unica_denuncia\('(\d+)'\)/i)?.[1] || null;
                break;
              }
              default:
                break;
            }
          }
        }

        return acto;
      });

    return {
      consulta: { criterio },
      coincidencias: actos.length > 0,
      total_actos: actos.length,
      mensaje:
        actos.length > 0
          ? `Se encontraron ${actos.length} coincidencias`
          : 'No se pudieron interpretar coincidencias',
      actos
    };
  }, criterioBusqueda);

const capturarBloqueActos = async (page, filePath) => {
  const captureContainer = page.locator(`#${ACTOS_CAPTURE_CONTAINER_ID}`).first();
  const input = page.locator('#pwd');
  const resultados = page.locator('#resultados');
  const viewport = page.viewportSize() || { width: 1440, height: 2200 };

  if (await captureContainer.count()) {
    await captureContainer.screenshot({ path: filePath });
    return;
  }

  await resultados.evaluate((node) => {
    node.scrollIntoView({
      behavior: 'auto',
      block: 'start',
      inline: 'nearest'
    });
  }).catch(() => null);

  const [inputBox, resultsBox] = await Promise.all([
    input.boundingBox().catch(() => null),
    resultados.boundingBox().catch(() => null)
  ]);

  if (inputBox && resultsBox) {
    const top = Math.max(0, Math.floor(inputBox.y - 220));
    const bottom = resultsBox.y + resultsBox.height + 140;
    const height = Math.min(Math.ceil(bottom - top), 12000);

    await page.screenshot({
      path: filePath,
      clip: {
        x: 0,
        y: top,
        width: Math.floor(viewport.width),
        height
      }
    });
    return;
  }

  await page.screenshot({
    path: filePath,
    fullPage: true
  });
};

module.exports = async ({ browser, placa, site, id_orden, output_key }) => {
  const criterioBusqueda = sanitizeCriteria(placa);

  if (!criterioBusqueda) {
    throw new Error('Debe enviar un criterio válido para actos administrativos.');
  }

  console.log(`🟢 Iniciando consulta FISCALÍA ACTOS para criterio ${criterioBusqueda}`);

  const context = await browser.newContext({
    userAgent: DEFAULT_USER_AGENT,
    viewport: {
      width: 1440,
      height: 2400
    }
  });

  const page = await context.newPage();

  try {
    await abrirModuloActos(page, site.url);
    await ensureActosCaptureScaffold(page, criterioBusqueda);

    let datos;

    try {
      let resultadosHtml;

      try {
        resultadosHtml = await fetchResultadosHtmlInBrowser(page, criterioBusqueda);
      } catch (browserError) {
        console.warn(`⚠️ FISCALÍA ACTOS navegador: ${browserError.message}`);
        resultadosHtml = await fetchResultadosHtmlDirect(criterioBusqueda);
      }

      await inyectarResultados(page, criterioBusqueda, resultadosHtml);

      datos = await extraerDatosActos(page, criterioBusqueda).catch((error) => {
        console.warn(`⚠️ No se pudo serializar JSON de FISCALÍA ACTOS: ${error.message}`);
        return {
          consulta: { criterio: criterioBusqueda },
          coincidencias: false,
          total_actos: 0,
          mensaje: 'No se pudo procesar la respuesta de Fiscalía',
          actos: []
        };
      });
    } catch (error) {
      console.warn(`⚠️ FISCALÍA ACTOS degradado: ${error.message}`);
      datos = buildBlockedData(criterioBusqueda, error.message || ACTOS_BLOCKED_MESSAGE);
      await mostrarMensajeActos(page, criterioBusqueda, datos.mensaje);
    }

    const { dir } = ensureScreenshotDir({
      baseDir: __dirname,
      placa,
      id_orden,
      output_key
    });

    const filename = `${site.key}.png`;
    const filePath = path.join(dir, filename);

    await capturarBloqueActos(page, filePath);

    console.log('📦 FISCALIA ACTOS JSON');
    console.log(JSON.stringify(datos, null, 2));

    await context.close();

    console.log('📸 Captura FISCALÍA ACTOS guardada');

    return {
      fuente: site.key,
      filename,
      descripcion: `Captura automatica del sitio ${site.key}`,
      datos
    };
  } catch (error) {
    await context.close().catch(() => null);
    throw error;
  }
};
