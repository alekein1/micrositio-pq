const path = require('path');
const { ensureScreenshotDir } = require('../utils/capturas.util');

const normalizeText = (value = '') => value.replace(/\s+/g, ' ').trim();

const getResultCard = (page) =>
  page.locator('div.card.my-4').filter({
    has: page.locator('h2', { hasText: 'Consulta valores a pagar por placa o chasis' })
  }).first();

const expandirDetalleValores = async (page) => {
  const detalleButton = page.locator('button').filter({
    hasText: /detalle valores/i
  }).first();

  if (await detalleButton.count()) {
    const buttonText = normalizeText(await detalleButton.textContent());

    if (/ver detalle valores/i.test(buttonText)) {
      await detalleButton.click();
      await page.waitForTimeout(1200);
    }
  }

  await page.waitForSelector('h2:has-text("Detalle de valores a pagar")', {
    timeout: 10000
  }).catch(() => null);
};

const ocultarOverlaysParaCaptura = async (page) => {
  await page.evaluate(() => {
    const hideElement = (element) => {
      element.style.setProperty('display', 'none', 'important');
      element.style.setProperty('visibility', 'hidden', 'important');
      element.style.setProperty('opacity', '0', 'important');
    };

    document.querySelectorAll('iframe, ins, .adsbygoogle').forEach(hideElement);

    [...document.querySelectorAll('body *')].forEach((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const fingerprint = `${element.id || ''} ${element.className || ''} ${element.innerText || ''}`
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

      const isFloating =
        ['fixed', 'sticky'].includes(style.position) &&
        rect.height >= 50 &&
        rect.bottom >= (window.innerHeight * 0.65);

      const isAdLike =
        /(ads|advert|banner|google|taboola|outbrain|remington|ver más)/i.test(fingerprint) &&
        rect.height >= 40;

      if (isFloating || isAdLike) {
        hideElement(element);
      }
    });
  });
};

const extraerDatosMatricula = async (page, placa) => {
  const resultCard = getResultCard(page);
  await resultCard.waitFor({ state: 'visible', timeout: 30000 });

  return resultCard.evaluate((card, placaConsultada) => {
    const normalize = (value = '') => value.replace(/\s+/g, ' ').trim();
    const cardText = normalize(card.innerText);
    const tables = [...card.querySelectorAll('table')];

    const rowsFromTable = (table) =>
      [...table.querySelectorAll('tr')]
        .map((row) =>
          [...row.children]
            .map((cell) => normalize(cell.innerText))
            .filter(Boolean)
        )
        .filter((row) => row.length > 0);

    const tableToObject = (table) => {
      const rows = rowsFromTable(table);
      if (rows.length < 2) return null;

      const headers = rows[0];
      const values = rows[1] || [];

      return headers.reduce((acc, header, index) => {
        acc[header] = values[index] || null;
        return acc;
      }, {});
    };

    const tableToPairs = (table) => {
      const rows = rowsFromTable(table);

      return rows.map((row) => ({
        concepto: row[0] || null,
        valor: row[row.length - 1] || null
      }));
    };

    const tableToDetailRows = (table) => {
      const rows = rowsFromTable(table);
      if (rows.length < 2) return [];

      const headers = rows[0];

      return rows
        .slice(1)
        .filter((row) => row.length >= headers.length)
        .filter((row) => !/^total:?$/i.test(row[0]))
        .map((row) =>
          headers.reduce((acc, header, index) => {
            acc[header] = row[index] || null;
            return acc;
          }, {})
        );
    };

    const matchGroup = (regex) => {
      const match = cardText.match(regex);
      return match?.[1] ? normalize(match[1]) : null;
    };

    const totalPagar =
      matchGroup(/A pagar:\s*(USD\s*\$[0-9.,]+)/i) ||
      matchGroup(/Total:\s*(USD\s*\$[0-9.,]+)/i);

    return {
      consulta: {
        placa: placaConsultada,
        ultimo_anio_pago: matchGroup(/Último año de pago\s+([0-9]{4})/i),
        chasis: /Chasis\s+Ver chasis/i.test(cardText)
          ? null
          : matchGroup(/Chasis\s+([A-Z0-9-]+)/i)
      },
      vehiculo: tables[0] ? tableToObject(tables[0]) : null,
      registro: tables[1] ? tableToObject(tables[1]) : null,
      fechas: tables[2] ? tableToObject(tables[2]) : null,
      resumen_valores: tables[3] ? tableToPairs(tables[3]) : [],
      total_pagar: totalPagar,
      detalle_valores: tables[4] ? tableToDetailRows(tables[4]) : []
    };
  }, placa);
};

const capturarBloqueResultados = async (page, filePath) => {
  const resultCard = getResultCard(page);

  if (await resultCard.count()) {
    await resultCard.scrollIntoViewIfNeeded();
    await ocultarOverlaysParaCaptura(page);

    await resultCard.screenshot({ path: filePath });
    return;
  }

  await page.screenshot({
    path: filePath,
    fullPage: true
  });
};

module.exports = async ({ browser, placa, site, id_orden, output_key }) => {
  console.log(`🟢 Iniciando captura MATRÍCULA para placa ${placa}`);

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    await page.goto(site.url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });

    await page.evaluate(() => {
      document.querySelectorAll('iframe').forEach(e => e.remove());
      document.body.style.overflow = 'auto';
    });

    await page.waitForSelector('select', { timeout: 30000 });
    await page.waitForSelector('input[type="text"]', { timeout: 30000 });

    await page.selectOption('select', { label: 'Placa' });

    await page.fill('input[type="text"]', placa);

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => b.innerText.toLowerCase().includes('consultar'));
      if (btn) btn.click();
    });

    await page.waitForFunction(() => {
      return !document.body.innerText.toLowerCase().includes('consultando');
    }, { timeout: 120000 });

    await getResultCard(page).waitFor({
      state: 'visible',
      timeout: 45000
    });

    await expandirDetalleValores(page);

  } catch (e) {
    console.warn(`⚠️ Error controlado en MATRÍCULA: ${e.message}`);
  }

  const datos = await extraerDatosMatricula(page, placa).catch((error) => {
    console.warn(`⚠️ No se pudo serializar JSON de MATRÍCULA: ${error.message}`);
    return {
      consulta: {
        placa
      },
      vehiculo: null,
      registro: null,
      fechas: null,
      resumen_valores: [],
      total_pagar: null,
      detalle_valores: []
    };
  });

  // ==========================
  // 📸 CAPTURA — NO SE TOCA NADA
  // ==========================
  const { dir } = ensureScreenshotDir({
    baseDir: __dirname,
    placa,
    id_orden,
    output_key
  });

  const filename = `${site.key}.png`;
  const filePath = path.join(dir, filename);

  await capturarBloqueResultados(page, filePath);

  console.log('📦 MATRÍCULA JSON');
  console.log(JSON.stringify(datos, null, 2));

  await context.close();

  console.log(`📸 Captura MATRÍCULA guardada`);

  // =======================================================
  // 🔥 SOLO ESTA PARTE CAMBIÓ (COMPATIBLE CON TU BACKEND)
  // =======================================================
  return {
    fuente: site.key,                                   // antes: site
    filename,                                           // antes: archivo (con path)
    descripcion: `Captura automática del sitio ${site.key}`,
    datos
  };
};
