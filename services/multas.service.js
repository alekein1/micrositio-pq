const path = require('path');
const fs = require('fs');

module.exports = async ({ browser, placa, site, id_orden }) => {
  console.log(`🟡 Iniciando captura MULTAS para placa ${placa}`);

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    // 1️⃣ ABRIR PÁGINA
    await page.goto(site.url, {
      waitUntil: 'networkidle',
      timeout: 120000
    });

    await page.waitForTimeout(3000);

    // 2️⃣ SELECCIONAR "Placa"
    await page.waitForSelector("select", { timeout: 15000 });
    await page.selectOption("select", { label: "Placa" });
    await page.waitForTimeout(1500);

    // 3️⃣ INGRESAR PLACA
    await page.fill("input", placa);
    await page.waitForTimeout(800);

    // 4️⃣ CLICK EN BUSCAR
    const botonBuscar = await page.locator("button", { hasText: "Buscar" });
    await botonBuscar.click();

    console.log("⏳ Esperando resultado de multas…");

    // ================================================================
    // 🧠 SISTEMA DE ESPERA ROBUSTO (3 capas)
    // ================================================================

    // 1️⃣ Espera fija garantizada — la página SIEMPRE demora
    await page.waitForTimeout(20000);

    // 2️⃣ Esperar que desaparezca un spinner o loader si existe
    try {
      await page.waitForSelector(
        ".loading, .spinner, .progress, .overlay, .lds-ring, .v-progress",
        { state: "detached", timeout: 180000 }
      );
    } catch (e) {
      console.log("⚠️ Loader no detectado o ya desapareció.");
    }

    // 3️⃣ Espera inteligente por texto dentro del DOM
    await page.waitForFunction(() => {
      const t = document.body.innerText.toLowerCase();
      return (
        t.includes("no tiene multas") ||
        t.includes("pendiente") ||
        t.includes("multa") ||
        t.includes("$") ||
        t.includes("resultado") ||
        t.includes("detalle")
      );
    }, { timeout: 180000 });

    // 4️⃣ Espera extra final para asegurar snapshot completo
    await page.waitForTimeout(5000);

  } catch (err) {
    console.warn(`⚠️ Error controlado en MULTAS: ${err.message}`);
  }

  // ================================================================
  // 📸 CAPTURA FINAL (NO SE TOCA)
  // ================================================================
  const dir = path.join(__dirname, `../screenshots/orden_${id_orden}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `${site.key}.png`;
  const filePath = path.join(dir, filename);

  await page.screenshot({
    path: filePath,
    fullPage: true
  });

  await context.close();

  console.log(`📸 Captura MULTAS guardada correctamente.`);

  // ================================================================
  // 🔥 RETORNO USADO POR TU BACKEND (NO CAMBIAR)
  // ================================================================
  return {
    fuente: site.key,
    filename,
    descripcion: `Captura automática del sitio ${site.key}`
  };
};