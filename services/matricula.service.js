const path = require('path');
const fs = require('fs');

module.exports = async ({ browser, placa, site, id_orden }) => {
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

    await page.waitForFunction(() => {
      const t = document.body.innerText.toLowerCase();
      return t.includes('el vehículo consultado');
    }, { timeout: 120000 });

  } catch (e) {
    console.warn(`⚠️ Error controlado en MATRÍCULA: ${e.message}`);
  }

  // ==========================
  // 📸 CAPTURA — NO SE TOCA NADA
  // ==========================
  const dir = path.join(__dirname, `../screenshots/orden_${id_orden}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `${site.key}.png`;
  const filePath = path.join(dir, filename);

  await page.evaluate(() => {
    window.scrollTo({
      top: document.body.scrollHeight * 0.18,
      behavior: 'instant'
    });
  });

  await page.waitForTimeout(1500);

  const viewport = page.viewportSize();

  await page.screenshot({
    path: filePath,
    clip: {
      x: 0,
      y: Math.floor(viewport.height * 0.02),
      width: viewport.width,
      height: Math.floor(viewport.height * 0.99)
    }
  });

  await context.close();

  console.log(`📸 Captura MATRÍCULA guardada`);

  // =======================================================
  // 🔥 SOLO ESTA PARTE CAMBIÓ (COMPATIBLE CON TU BACKEND)
  // =======================================================
  return {
    fuente: site.key,                                   // antes: site
    filename,                                           // antes: archivo (con path)
    descripcion: `Captura automática del sitio ${site.key}`
  };
};