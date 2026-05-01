const sites = require('../config/sites.config');
const { getBrowser } = require('../services/browser.service');
const {
  sanitizeFolderToken,
  hasOrderId,
  buildOutputFolderName,
  clearGeneratedScreenshots,
  buildImageUrl
} = require('../utils/capturas.util');

const UNIFIED_SITES = [
  {
    key: 'matricula',
    url: 'https://ant.com.ec/matriculas/consultar-valor-matricula',
    handler: 'matricula'
  },
  {
    key: 'fiscalia',
    url: 'https://www.fiscalia.gob.ec/consulta-de-noticias-del-delito/',
    handler: 'fiscalia'
  },
  {
    key: 'axiscloud',
    url: 'https://servicios.axiscloud.ec/AutoServicio/inicio.jsp?ps_empresa=06&ps_accion=P55',
    handler: 'axiscloud'
  },
  {
    key: 'fiscalia_actos',
    url: 'https://www.fiscalia.gob.ec/consulta-de-actos-administrativos/',
    handler: 'fiscalia_actos'
  }
];

const getSearchCriteria = (body = {}) => `${body.criterio ?? body.placa ?? ''}`.trim();

const getActiveSites = () => sites.filter((site) => site.enabled !== false);

const getUnifiedSites = () => UNIFIED_SITES.map((site) => ({ ...site }));

const buildUnifiedOutputKey = (placa) => `placa_${sanitizeFolderToken(placa)}`;

const deepCleanValue = (value) => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => deepCleanValue(item))
      .filter((item) => item !== undefined);
  }

  if (typeof value === 'object') {
    const cleanedEntries = Object.entries(value)
      .map(([key, entryValue]) => [key, deepCleanValue(entryValue)])
      .filter(([, entryValue]) => entryValue !== undefined);

    if (!cleanedEntries.length) {
      return undefined;
    }

    return Object.fromEntries(cleanedEntries);
  }

  return value;
};

const normalizeProviderDatos = (fuente, datos) => {
  if (!datos || typeof datos !== 'object') {
    return datos;
  }

  const baseData = fuente === 'axiscloud'
    ? {
        info_placa: datos.info_placa,
        mi_cuenta: datos.mi_cuenta
      }
    : datos;

  return deepCleanValue(baseData) || {};
};

const buildUnifiedSources = (imagenes = []) =>
  Object.fromEntries(
    imagenes.map((imagen) => [
      imagen.fuente,
      {
        ok: !imagen.error && Boolean(imagen.filename),
        imagen: {
          filename: imagen.filename,
          url: imagen.url,
          descripcion: imagen.descripcion
        },
        datos: imagen.datos,
        error: imagen.error || null
      }
    ])
  );

const createImagePayload = ({ folderName, site, resultado, error = null }) => {
  if (error) {
    return {
      fuente: site.key,
      filename: null,
      url: null,
      descripcion: 'Error en captura',
      datos: null,
      error: error.message
    };
  }

  return {
    fuente: site.key,
    filename: resultado.filename,
    url: buildImageUrl(folderName, resultado.filename),
    descripcion: resultado.descripcion || null,
    datos: resultado.datos || null
  };
};

const createResultPayload = ({ folderName, site, resultado, error = null }) => {
  if (error) {
    return {
      site: site.key,
      estado: 'error',
      mensaje: error.message
    };
  }

  return {
    site: site.key,
    estado: 'ok',
    filename: resultado.filename,
    url: buildImageUrl(folderName, resultado.filename),
    descripcion: resultado.descripcion || null,
    datos: resultado.datos || null
  };
};

const executeCaptureFlow = async ({ placa, id_orden, forceUnified = false }) => {
  const unified = forceUnified || !hasOrderId(id_orden);
  const selectedSites = unified ? getUnifiedSites() : getActiveSites();

  if (!selectedSites.length) {
    throw new Error('No hay sitios activos configurados para procesar la consulta.');
  }

  const output_key = unified ? buildUnifiedOutputKey(placa) : null;
  const folderName = buildOutputFolderName({ placa, id_orden, output_key });

  if (unified) {
    clearGeneratedScreenshots({
      baseDir: __dirname,
      folderName,
      siteKeys: selectedSites.map((site) => site.key)
    });
  }

  const browser = await getBrowser();
  const imagenes = [];
  const resultados = [];

  try {
    for (const site of selectedSites) {
      console.log(`🚀 Iniciando captura ${site.key} para placa ${placa}`);

      try {
        const handler = require(`../services/${site.handler}.service`);

        const resultado = await handler({
          browser,
          placa,
          site,
          id_orden,
          output_key
        });

        resultado.datos = normalizeProviderDatos(site.key, resultado.datos);

        imagenes.push(createImagePayload({ folderName, site, resultado }));
        resultados.push(createResultPayload({ folderName, site, resultado }));
      } catch (error) {
        console.error(`❌ Error en ${site.key}:`, error.message);

        imagenes.push(createImagePayload({ folderName, site, error }));
        resultados.push(createResultPayload({ folderName, site, error }));
      }
    }
  } finally {
    await browser.close();
  }

  return {
    unified,
    folderName,
    imagenes,
    resultados
  };
};

const handleCapturas = async (req, res, { responseKey = 'imagenes', forceUnified = false } = {}) => {
  const criterioBusqueda = getSearchCriteria(req.body);
  const { id_orden } = req.body;
  const placa = criterioBusqueda;

  if (!placa) {
    return res.status(400).json({
      ok: false,
      error: 'Debe enviar la placa o criterio.'
    });
  }

  try {
    const { unified, folderName, imagenes, resultados } = await executeCaptureFlow({
      placa,
      id_orden,
      forceUnified
    });

    const responseBody = {
      ok: true,
      criterio: criterioBusqueda,
      placa,
      id_orden: hasOrderId(id_orden) ? id_orden : null,
      carpeta: folderName,
      modo: unified ? 'unificado' : 'configurado',
      total: responseKey === 'resultados' ? resultados.length : imagenes.length
    };

    responseBody[responseKey] = responseKey === 'resultados' ? resultados : imagenes;

    if (unified) {
      responseBody.total_fuentes = imagenes.length;
      responseBody.sitios_consultados = imagenes.map((imagen) => imagen.fuente);
      responseBody.fuentes = buildUnifiedSources(imagenes);
    }

    return res.json(responseBody);
  } catch (error) {
    console.error('❌ ERROR en captura:', error);
    return res.status(500).json({
      ok: false,
      error: 'Error generando capturas automáticas.'
    });
  }
};

exports.iniciarCapturas = async (req, res) =>
  handleCapturas(req, res, { responseKey: 'resultados' });

exports.iniciarCapturasSync = async (req, res) =>
  handleCapturas(req, res, { responseKey: 'imagenes' });

exports.iniciarCapturasUnificadas = async (req, res) =>
  handleCapturas(req, res, { responseKey: 'imagenes', forceUnified: true });
