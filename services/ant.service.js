const path = require('path');
const fs = require('fs');

module.exports = async ({ browser, placa, site, id_orden }) => {
  const page = await browser.newPage();

  console.log(`🟡 Iniciando captura ANT para placa ${placa}`);

  try {
    await page.goto(site.url, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    // Esperar select real
    await page.waitForSelector('select', { timeout: 30000 });

    // Seleccionar PLACA
    await page.selectOption('select', { label: 'PLACA' });

    // Input de placa
    await page.fill('input', placa);

    // 🔥 SUBMIT REAL
    await page.evaluate(() => {
      const form = document.querySelector('form');
      if (form) form.submit();
    });

    await page.waitForTimeout(6000);

  } catch (error) {
    console.warn('⚠️ ANT error controlado:', error.message);
  }

  // Directorio por orden
  const dir = path.join(__dirname, `../screenshots/orden_${id_orden}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // SOLO el filename
  const filename = `${site.key}_${placa}.png`;
  const filePath = path.join(dir, filename);

  await page.screenshot({
    path: filePath,
    fullPage: true
  });

  await page.close();

  console.log(`📸 Captura ANT guardada: ${filePath}`);

  // 🔥 ESTO ES LO QUE EL BACKEND ESPERA 🔥
  return {
    fuente: site.key,
    filename,
    descripcion: `Captura del sitio ${site.key}`
  };
};