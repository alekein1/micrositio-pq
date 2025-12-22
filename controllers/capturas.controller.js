const sites = require('../config/sites.config');
const { getBrowser } = require('../services/browser.service');

exports.iniciarCapturas = async (req, res) => {
  const { placa, id_orden } = req.body;

  if (!placa || !id_orden) {
    return res.status(400).json({
      ok: false,
      mensaje: 'Placa e id_orden son obligatorios'
    });
  }

  const resultados = [];
  const browser = await getBrowser();

  try {
    // 🔥 SOLO sitios habilitados
    const sitiosActivos = sites.filter(site => site.enabled !== false);

    for (const site of sitiosActivos) {
      console.log(`🚀 Iniciando captura ${site.key} para placa ${placa}`);

      try {
        const handler = require(`../services/${site.handler}.service`);

        const resultado = await handler({
          browser,
          placa,
          site,
          id_orden
        });

        resultados.push(resultado);

      } catch (error) {
        console.error(`❌ Error en ${site.key}:`, error.message);

        resultados.push({
          site: site.key,
          estado: 'error',
          mensaje: error.message
        });
      }
    }

    return res.json({
      ok: true,
      placa,
      id_orden,
      total: resultados.length,
      resultados
    });

  } finally {
    // 🔒 SIEMPRE cerrar navegador
    await browser.close();
  }
};

exports.iniciarCapturasSync = async (req, res) => {
  try {
    const { placa, id_orden } = req.body;

    if (!placa || !id_orden) {
      return res.status(400).json({
        ok: false,
        error: "Debe enviar placa e id_orden."
      });
    }

    const browser = await getBrowser();
    const imagenes = [];

    try {
      const sitiosActivos = sites.filter(site => site.enabled !== false);

      for (const site of sitiosActivos) {
        console.log(`📸 Capturando sitio: ${site.key}`);

        try {
          const handler = require(`../services/${site.handler}.service`);

          const resultado = await handler({
            browser,
            placa,
            site,
            id_orden   // 🔥🔥🔥 AQUÍ ESTABA EL ERROR
          });

          imagenes.push({
            fuente: site.key,
            filename: resultado.filename,
            descripcion: resultado.descripcion || null
          });

        } catch (error) {
          console.error("❌ Error capturando sitio:", site.key, error);

          imagenes.push({
            fuente: site.key,
            filename: null,
            descripcion: "Error en captura"
          });
        }
      }

      res.json({
        ok: true,
        placa,
        id_orden,
        total: imagenes.length,
        imagenes
      });

    } finally {
      await browser.close();
    }

  } catch (error) {
    console.error("❌ ERROR iniciarCapturasSync:", error);
    res.status(500).json({
      ok: false,
      error: "Error generando capturas automáticas."
    });
  }
};