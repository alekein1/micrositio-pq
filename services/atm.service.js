const path = require('path');
const fs = require('fs');

module.exports = async ({ browser, placa, site, id_orden }) => {
  const page = await browser.newPage();

  console.log(`🔍 ATM | Consultando placa ${placa}`);

  try {
    await page.goto(site.url, {
      waitUntil: 'networkidle',
      timeout: 60000
    });

    await page.waitForSelector('select', { timeout: 15000 });

    await page.selectOption('select', { label: 'PLACA' });

    await page.fill('input', placa);

    await page.evaluate(() => {
      const form = document.querySelector('form');
      if (form) form.submit();
    });

    await page.waitForTimeout(6000);

  } catch (error) {
    console.warn(`⚠️ ATM error controlado: ${error.message}`);
  }

  // 📁 carpeta por orden
  const dir = path.join(__dirname, `../screenshots/orden_${id_orden}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filename = `${site.key}.png`;
  const filePath = path.join(dir, filename);

  await page.screenshot({
    path: filePath,
    fullPage: true
  });

  await page.close();

  console.log(`📸 ATM captura guardada: ${filePath}`);

  // 🔥 DEVOLVEMOS EXACTAMENTE LO QUE EL BACKEND NECESITA
  return {
    fuente: site.key,
    filename, // solo nombre del archivo
    descripcion: `Captura automática del sitio ${site.key}`
  };
};