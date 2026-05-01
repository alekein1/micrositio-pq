const path = require('path');
const { ensureScreenshotDir } = require('../utils/capturas.util');

const FALLBACK_MODULE_URL =
  'https://www.gestiondefiscalias.gob.ec/siaf/informacion/web/noticiasdelito/index.php';
const RESULTADOS_URL =
  'https://www.gestiondefiscalias.gob.ec/siaf/comunes/noticiasdelito/info_mod.php';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';
const FISCALIA_BLOCKED_MESSAGE = 'El proveedor bloqueó temporalmente la consulta de Fiscalía.';
const FISCALIA_CAPTURE_CONTAINER_ID = 'codex_fiscalia_capture';

const normalizeText = (value = '') => value.replace(/\s+/g, ' ').trim();

const sanitizeCriteria = (value = '') =>
  normalizeText(value)
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildBusinfo = (criterio) =>
  `a:1:{i:0;s:${Buffer.byteLength(criterio, 'utf8')}:"${criterio}";}`;

const isBlockedHtml = (html = '') =>
  /_Incapsula_Resource|No autorizado, solicite soporte técnico|Request unsuccessful\. Incapsula/i.test(
    html
  );

const buildBlockedData = (criterioBusqueda, mensaje = FISCALIA_BLOCKED_MESSAGE) => ({
  consulta: {
    criterio: criterioBusqueda
  },
  coincidencias: false,
  total_casos: 0,
  mensaje,
  casos: []
});

const abrirModuloFiscalia = async (page, siteUrl) => {
  await page.goto(siteUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  const iframe = page.locator('iframe#blockrandom, iframe[src*="gestiondefiscalias.gob.ec"]').first();

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

const ensureFiscaliaCaptureScaffold = async (page, criterioBusqueda) => {
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
        <div style="font-size:18px;color:#374151;margin-top:6px;">Consulta de noticias del delito</div>
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
    containerId: FISCALIA_CAPTURE_CONTAINER_ID
  });
};

const fetchResultadosHtmlInBrowser = async (page, criterioBusqueda) => {
  const response = await page.evaluate(async ({ criterio }) => {
    const len = new TextEncoder().encode(criterio).length;
    const businfo = `a:1:{i:0;s:${len}:"${criterio}";}`;
    const url = `../../../comunes/noticiasdelito/info_mod.php?businfo=${encodeURIComponent(businfo)}`;

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
    throw new Error(FISCALIA_BLOCKED_MESSAGE);
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
    throw new Error(FISCALIA_BLOCKED_MESSAGE);
  }

  return html;
};

const inyectarResultados = async (page, criterioBusqueda, resultadosHtml) => {
  await ensureFiscaliaCaptureScaffold(page, criterioBusqueda);

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

const mostrarMensajeFiscalia = async (page, criterioBusqueda, mensaje) => {
  await ensureFiscaliaCaptureScaffold(page, criterioBusqueda);

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

const extraerDatosFiscalia = async (page, criterio) => {
  const resultados = page.locator('#resultados');
  await resultados.waitFor({ state: 'attached', timeout: 30000 });

  return resultados.evaluate((node, criterioBusqueda) => {
    const normalize = (value = '') => value.replace(/\s+/g, ' ').trim();

    const getTitle = (table) =>
      normalize(table.querySelector('thead th')?.innerText || '');

    const parseRows = (table) =>
      [...table.querySelectorAll('tr')]
        .map((row) =>
          [...row.children]
            .map((cell) => normalize(cell.innerText))
        )
        .filter((row) => row.some((cell) => cell !== ''));

    const parseListado = (table) => {
      const rows = parseRows(table);
      const headerIndex = rows.findIndex((row) => row.length > 1);

      if (headerIndex === -1) return [];

      const headers = rows[headerIndex];

      return rows
        .slice(headerIndex + 1)
        .map((row) =>
          headers.reduce((acc, header, index) => {
            acc[header] = row[index] || null;
            return acc;
          }, {})
        )
        .filter((item) => Object.values(item).some((value) => value));
    };

    const parseCaso = (table) => {
      const headerText = getTitle(table);
      const rows = [...table.querySelectorAll('tbody tr')];

      const caso = {
        noticia_del_delito: headerText || null,
        noticia_del_delito_numero: headerText.match(/Nro\.\s*([0-9]+)/i)?.[1] || null,
        tipo: headerText.includes(' - ')
          ? headerText.split(' - ').slice(1).join(' - ').trim()
          : null,
        lugar: null,
        fecha: null,
        hora: null,
        digitador: null,
        estado: null,
        nro_oficio: null,
        delito: null,
        unidad: null,
        fiscalia: null,
        sujetos: [],
        vehiculos: []
      };

      for (const row of rows) {
        let cells = [...row.querySelectorAll('td')]
          .map((cell) => normalize(cell.innerText));

        if (row.querySelector('img')) {
          cells = cells.slice(1);
        }

        if (!cells.some((cell) => cell !== '')) continue;

        if (cells[0] === 'LUGAR') {
          caso.lugar = cells[1] || null;
          caso.fecha = cells[3] || null;
        } else if (cells[0] === 'HORA') {
          caso.hora = cells[1] || null;
          caso.digitador = cells[3] || null;
        } else if (/^ESTADO:?$/i.test(cells[0])) {
          caso.estado = cells[1] || null;
          caso.nro_oficio = cells[3] || null;
        } else if (/^DELITO:?$/i.test(cells[0])) {
          caso.delito = cells[1] || null;
        } else if (/^UNIDAD:?$/i.test(cells[0])) {
          caso.unidad = cells[1] || null;

          const fiscaliaCell = cells.find((cell) => /^FISCALIA:/i.test(cell));
          if (fiscaliaCell) {
            caso.fiscalia = fiscaliaCell
              .replace(/^FISCALIA:\s*/i, '')
              .replace(/\s*Este es mi caso\s*$/i, '')
              .trim();
          }
        }
      }

      return caso;
    };

    const resultText = normalize(node.innerText);

    if (/No existen coincidencias/i.test(resultText)) {
      return {
        consulta: {
          criterio: criterioBusqueda
        },
        coincidencias: false,
        total_casos: 0,
        mensaje: 'No existen coincidencias para los criterios ingresados',
        casos: []
      };
    }

    const tables = [...node.querySelectorAll('table')];
    const casos = [];

    for (let index = 0; index < tables.length; index += 1) {
      const title = getTitle(tables[index]);

      if (!/^NOTICIA DEL DELITO Nro\./i.test(title)) continue;

      const caso = parseCaso(tables[index]);

      const subjectsTable = tables[index + 1];
      if (subjectsTable && getTitle(subjectsTable) === 'SUJETOS') {
        caso.sujetos = parseListado(subjectsTable);
        index += 1;
      }

      const vehiclesTable = tables[index + 1];
      if (vehiclesTable && getTitle(vehiclesTable) === 'VEHICULOS') {
        caso.vehiculos = parseListado(vehiclesTable);
        index += 1;
      }

      casos.push(caso);
    }

    return {
      consulta: {
        criterio: criterioBusqueda
      },
      coincidencias: casos.length > 0,
      total_casos: casos.length,
      mensaje: casos.length > 0
        ? `Se encontraron ${casos.length} coincidencias`
        : 'No se pudieron interpretar coincidencias',
      casos
    };
  }, criterio);
};

const capturarBloqueFiscalia = async (page, filePath) => {
  const captureContainer = page.locator(`#${FISCALIA_CAPTURE_CONTAINER_ID}`).first();
  const input = page.locator('#pwd');
  const resultados = page.locator('#resultados');
  const viewport = page.viewportSize() || { width: 1440, height: 2200 };

  if (await captureContainer.count()) {
    await captureContainer.screenshot({ path: filePath });
    return;
  }

  const [inputBox, resultsBox] = await Promise.all([
    input.boundingBox().catch(() => null),
    resultados.boundingBox().catch(() => null)
  ]);

  if (inputBox && resultsBox) {
    const top = Math.max(0, Math.floor(inputBox.y - 180));
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
    throw new Error('Debe enviar un criterio de búsqueda válido para Fiscalía.');
  }

  if (criterioBusqueda.length < 5) {
    throw new Error('El criterio de búsqueda para Fiscalía debe tener al menos 5 caracteres.');
  }

  console.log(`🟢 Iniciando consulta FISCALÍA para criterio ${criterioBusqueda}`);

  const context = await browser.newContext({
    userAgent: DEFAULT_USER_AGENT,
    viewport: {
      width: 1440,
      height: 2200
    }
  });

  const page = await context.newPage();

  try {
    await abrirModuloFiscalia(page, site.url);
    await ensureFiscaliaCaptureScaffold(page, criterioBusqueda);

    let datos;

    try {
      let resultadosHtml;

      try {
        resultadosHtml = await fetchResultadosHtmlInBrowser(page, criterioBusqueda);
      } catch (browserError) {
        console.warn(`⚠️ FISCALÍA navegador: ${browserError.message}`);
        resultadosHtml = await fetchResultadosHtmlDirect(criterioBusqueda);
      }

      await inyectarResultados(page, criterioBusqueda, resultadosHtml);

      datos = await extraerDatosFiscalia(page, criterioBusqueda).catch((error) => {
        console.warn(`⚠️ No se pudo serializar JSON de FISCALÍA: ${error.message}`);
        return {
          consulta: {
            criterio: criterioBusqueda
          },
          coincidencias: false,
          total_casos: 0,
          mensaje: 'No se pudo procesar la respuesta de Fiscalía',
          casos: []
        };
      });
    } catch (error) {
      console.warn(`⚠️ FISCALÍA degradado: ${error.message}`);
      datos = buildBlockedData(criterioBusqueda, error.message || FISCALIA_BLOCKED_MESSAGE);
      await mostrarMensajeFiscalia(page, criterioBusqueda, datos.mensaje);
    }

    const { dir } = ensureScreenshotDir({
      baseDir: __dirname,
      placa,
      id_orden,
      output_key
    });

    const filename = `${site.key}.png`;
    const filePath = path.join(dir, filename);

    await capturarBloqueFiscalia(page, filePath);

    console.log('📦 FISCALIA JSON');
    console.log(JSON.stringify(datos, null, 2));

    await context.close();

    console.log('📸 Captura FISCALÍA guardada');

    return {
      fuente: site.key,
      filename,
      descripcion: `Captura automática del sitio ${site.key}`,
      datos
    };
  } catch (error) {
    await context.close().catch(() => null);
    throw error;
  }
};
