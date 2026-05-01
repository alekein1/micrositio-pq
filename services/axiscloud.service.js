const path = require('path');
const { ensureScreenshotDir } = require('../utils/capturas.util');

const DIRECT_AXIS_URL =
  'https://servicios.axiscloud.ec/AutoServicioConsultaInfracciones/paginas/ConsultaInfracciones.jsp';
const AXIS_SEARCH_MAX_ATTEMPTS = 3;
const AXIS_RETRY_WAIT_MS = 1500;
const AXIS_RECAPTCHA_WAIT_MS = 30000;
const AXIS_RECAPTCHA_SITE_KEY = '6LcRfVwpAAAAAHmx7rhLmFqHyMcVZWqYt1URz0UD';
let axisQueue = Promise.resolve();

const normalizeText = (value = '') => value.replace(/\s+/g, ' ').trim();

const normalizeScalar = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const normalized = normalizeText(value);
    return normalized === '' ? null : normalized;
  }
  return value;
};

const normalizeNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const formatCurrencyFromCents = (value) => {
  const cents = normalizeNumber(value);
  if (cents === null) return null;
  return `$${(cents / 100).toFixed(2)}`;
};

const normalizeLabelValue = (entry) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return normalizeScalar(entry);
  }

  return {
    etiqueta: normalizeScalar(entry.etiqueta),
    valor: normalizeScalar(entry.valor ?? entry.Valor)
  };
};

const getAxisValue = (entry) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return normalizeScalar(entry);
  }

  return normalizeScalar(entry.valor ?? entry.Valor);
};

const normalizeObject = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeObject).filter((item) => {
      if (item === null || item === undefined) return false;
      if (typeof item === 'string' && item === '') return false;
      if (typeof item === 'object') {
        return Object.values(item).some((entry) => {
          if (entry === null || entry === undefined) return false;
          if (typeof entry === 'string') return entry !== '';
          if (Array.isArray(entry)) return entry.length > 0;
          if (typeof entry === 'object') return Object.values(entry).some(Boolean);
          return true;
        });
      }
      return true;
    });
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          ('valor' in entry || 'Valor' in entry || 'etiqueta' in entry)
        ) {
          return [key, normalizeLabelValue(entry)];
        }

        return [key, normalizeObject(entry)];
      })
    );
  }

  return normalizeScalar(value);
};

const normalizeTotals = (totales = {}) =>
  Object.fromEntries(
    Object.entries(totales).map(([key, entry]) => [
      key.toLowerCase(),
      {
        etiqueta: normalizeScalar(entry?.etiqueta),
        cantidad: normalizeScalar(entry?.cantidad),
        valor: normalizeScalar(entry?.valor),
        total: normalizeScalar(entry?.total),
        saldo: normalizeScalar(entry?.saldo),
        interes: normalizeScalar(entry?.interes),
        descuento: normalizeScalar(entry?.descuento ?? entry?.Descuento),
        exo_interes: normalizeScalar(entry?.exoInteres),
        comision: normalizeScalar(entry?.comision),
        pagos: normalizeScalar(entry?.pagos),
        valor_pagado: normalizeScalar(entry?.valorPagado)
      }
    ])
  );

const normalizeEstadoCuenta = (estado = {}) => ({
  total: normalizeLabelValue(estado.TOTAL),
  exoneracion_interes: normalizeLabelValue(estado.EXOINTERES),
  interes: normalizeLabelValue(estado.INTERES),
  descuento: normalizeLabelValue(estado.DESCUENTO),
  pendiente: normalizeLabelValue(estado.PENDIENTE),
  convenio: normalizeLabelValue(estado.CONVENIO),
  coactiva: normalizeLabelValue(estado.COACTIVA),
  comision: normalizeLabelValue(estado.COMISION),
  bloqueo: normalizeLabelValue(estado.BLOQUEO),
  pagos: normalizeLabelValue(estado.PAGOS),
  mensaje: normalizeLabelValue(estado.MENSAJE),
  realiza_cobranza: normalizeScalar(estado.lsRealizaCobranza),
  presentar_deuda_consolidada: normalizeScalar(estado.lsPresentarDeudaConsolidada)
});

const normalizeInfoPlaca = (info = {}) => ({
  placa: getAxisValue(info.PLACA),
  identificacion: normalizeScalar(info.identificacion),
  tipo_identificacion: normalizeScalar(info.tipoIdent),
  nombres: normalizeScalar(info.nombres),
  marca: getAxisValue(info.MARCA),
  modelo: getAxisValue(info.MODELO),
  anio: getAxisValue(info.ANIO),
  clase: getAxisValue(info.CLASE),
  tipo_vehiculo: getAxisValue(info.TIPOVEHICULO),
  servicio: getAxisValue(info.SERVICIO),
  servicio_codigo: getAxisValue(info.SERVICIO_COD),
  color: getAxisValue(info.COLOR1),
  pais_fabricacion: getAxisValue(info.PAIS),
  matricula_anio: getAxisValue(info.MATRICULA),
  fecha_matricula: getAxisValue(info.FECHAMATRICULA),
  lugar_matricula: getAxisValue(info.LUGARMATRICULA),
  fecha_caducidad: getAxisValue(info.CADMATRICULA),
  datos_rtv: Array.isArray(info.DATOSRTV)
    ? info.DATOSRTV.map((entry) => ({
        anio_revision: getAxisValue(entry.ANIO),
        fecha_revision_desde: getAxisValue(entry.DESDE),
        fecha_revision_hasta: getAxisValue(entry.HASTA),
        lugar_revision: getAxisValue(entry.EMPRESA)
      }))
    : []
});

const normalizeAxisDebtItem = (entry = {}) => {
  const totalPendienteCentavos = normalizeNumber(entry.liTotalPendiente);
  const cantidad = normalizeNumber(entry.liCantidad);

  return {
    empresa: normalizeScalar(entry.lsEmpresa),
    id_empresa: normalizeScalar(entry.lsIdEmpresa),
    cantidad,
    valor_centavos: totalPendienteCentavos,
    valor: formatCurrencyFromCents(totalPendienteCentavos)
  };
};

const normalizeMiCuentaSection = (rows = []) =>
  Array.isArray(rows) ? rows.map(normalizeAxisDebtItem) : [];

const hasMiCuentaDetails = (miCuenta) => {
  if (!miCuenta?.disponible) return false;

  return Boolean(
    (Array.isArray(miCuenta.deuda_axiscloud) && miCuenta.deuda_axiscloud.length > 0) ||
    (Array.isArray(miCuenta.deuda_institucion) && miCuenta.deuda_institucion.length > 0) ||
    (Array.isArray(miCuenta.deuda_ant) && miCuenta.deuda_ant.length > 0) ||
    miCuenta.error_ant ||
    miCuenta.etiquetas?.institucion ||
    miCuenta.etiquetas?.otras_instituciones ||
    miCuenta.etiquetas?.instituciones_externas
  );
};

const isRetryableAxisError = (payload) => {
  const code = normalizeScalar(payload?.lsCodError);
  const message = normalizeScalar(payload?.lsError ?? payload?.lsMensaje) || '';

  return code === '010' || /sesiones permitidas|intente mas tarde|intente más tarde/i.test(message);
};

const buildEmptyMiCuenta = (criterioBusqueda, mensaje, codigoRespuesta = null) => ({
  consulta: {
    tipo_busqueda: 'Placa',
    criterio: criterioBusqueda,
    codigo_respuesta: codigoRespuesta
  },
  disponible: false,
  mensaje,
  etiquetas: {
    institucion: null,
    otras_instituciones: null,
    instituciones_externas: null
  },
  error_ant: null,
  deuda_axiscloud: [],
  deuda_institucion: [],
  deuda_ant: [],
  resumen: {
    total_fuentes_axiscloud: 0,
    total_infracciones_axiscloud: 0,
    total_pendiente_axiscloud_centavos: 0,
    total_pendiente_axiscloud: '$0.00'
  }
});

const buildAxisMiCuentaData = (payload, criterioBusqueda) => {
  const deudaAxisCloud = normalizeMiCuentaSection(payload?.laDeudaAxisCloud);
  const deudaInstitucion = normalizeObject(payload?.laDeudaInstitucion || []);
  const deudaAnt = normalizeObject(payload?.laDeudaAnt || []);

  const totalPendienteCentavos = deudaAxisCloud.reduce(
    (sum, entry) => sum + (entry.valor_centavos || 0),
    0
  );

  const totalInfracciones = deudaAxisCloud.reduce(
    (sum, entry) => sum + (entry.cantidad || 0),
    0
  );

  return {
    consulta: {
      tipo_busqueda: 'Placa',
      criterio: criterioBusqueda,
      codigo_respuesta: normalizeScalar(payload?.lsCodError)
    },
    disponible: normalizeScalar(payload?.lsCodError) === '0',
    mensaje: normalizeScalar(payload?.lsError) || 'Mi Cuenta consultada correctamente',
    etiquetas: {
      institucion: normalizeScalar(payload?.lsEtiquetaInstitucion),
      otras_instituciones: normalizeScalar(payload?.lsEtiquetaOtrasInstitucion),
      instituciones_externas: normalizeScalar(payload?.lsEtiquetaExterna)
    },
    error_ant: normalizeScalar(payload?.lsErrorAnt),
    deuda_axiscloud: deudaAxisCloud,
    deuda_institucion: deudaInstitucion,
    deuda_ant: deudaAnt,
    resumen: {
      total_fuentes_axiscloud: deudaAxisCloud.length,
      total_infracciones_axiscloud: totalInfracciones,
      total_pendiente_axiscloud_centavos: totalPendienteCentavos,
      total_pendiente_axiscloud: formatCurrencyFromCents(totalPendienteCentavos)
    }
  };
};

const buildAxisData = (payload, criterioBusqueda, miCuenta = null) => {
  const pendientes = normalizeObject(payload?.lsPendiente?.PENDIENTES || []);
  const pagadas = normalizeObject(payload?.lsPagadas?.PAGADAS || []);
  const anuladas = normalizeObject(payload?.lsAnuladas?.ANULADAS || []);
  const convenios = normalizeObject(payload?.lsConvenios?.CONVENIO || []);
  const coactivas = normalizeObject(payload?.lsCoactiva?.COACTIVAS || []);
  const impugnadas = normalizeObject(payload?.lsImpugnadas?.IMPUGNACION || []);
  const encontrado = Boolean(payload?.lsInfoPlaca);

  return {
    consulta: {
      tipo_busqueda: 'Placa',
      criterio: criterioBusqueda,
      codigo_respuesta: normalizeScalar(payload?.lsCodError)
    },
    encontrado,
    mensaje: normalizeScalar(payload?.lsError) || 'Consulta procesada correctamente',
    info_placa: encontrado ? normalizeInfoPlaca(payload.lsInfoPlaca) : null,
    estado_cuenta: normalizeEstadoCuenta(payload?.lsEstadoCta || {}),
    totales_por_estado: normalizeTotals(payload?.lsTotales || {}),
    infracciones: {
      pendientes,
      pagadas,
      anuladas,
      convenios,
      coactivas,
      impugnadas
    },
    mi_cuenta:
      miCuenta ||
      buildEmptyMiCuenta(
        criterioBusqueda,
        'Mi Cuenta no se consulto porque la respuesta inicial no fue exitosa.',
        normalizeScalar(payload?.lsCodError)
      ),
    resumen: {
      pendientes: pendientes.length,
      pagadas: pagadas.length,
      anuladas: anuladas.length,
      convenios: convenios.length,
      coactivas: coactivas.length,
      impugnadas: impugnadas.length
    }
  };
};

const capturarBloqueAxis = async (page, frame, filePath) => {
  const miCuentaContainer = frame.locator('#codex_axis_mi_cuenta_capture').first();
  const mainContainer = frame.locator('main.container2').first();
  const container = frame.locator('div.container-fluid').first();

  if (await miCuentaContainer.count()) {
    await miCuentaContainer.screenshot({ path: filePath });
    return;
  }

  if (await mainContainer.count()) {
    await mainContainer.screenshot({ path: filePath });
    return;
  }

  if (await container.count()) {
    await container.screenshot({ path: filePath });
    return;
  }

  await page.screenshot({
    path: filePath,
    fullPage: true
  });
};

const mostrarMensajeErrorEnPantalla = async (frame, criterioBusqueda, mensaje) => {
  await frame.evaluate(({ criterio, errorMensaje }) => {
    const input = document.querySelector('#valor_busqueda');
    if (input) input.value = criterio;

    let errorBox = document.querySelector('#codex_axis_error_box');
    if (!errorBox) {
      errorBox = document.createElement('div');
      errorBox.id = 'codex_axis_error_box';
      errorBox.style.margin = '12px';
      errorBox.style.padding = '16px';
      errorBox.style.border = '1px solid #dc3545';
      errorBox.style.borderRadius = '8px';
      errorBox.style.background = '#fdeaea';
      errorBox.style.color = '#7a1c22';
      errorBox.style.fontFamily = 'Arial, sans-serif';
      errorBox.style.fontSize = '14px';
      errorBox.style.lineHeight = '1.4';

      const container = document.querySelector('div.container-fluid');
      const reference = document.querySelector('#dv_informacion') || container?.lastElementChild || null;

      if (reference && reference.parentNode) {
        reference.parentNode.insertBefore(errorBox, reference);
      } else if (container) {
        container.appendChild(errorBox);
      } else {
        document.body.appendChild(errorBox);
      }
    }

    errorBox.innerHTML = `
      <strong>Respuesta del proveedor</strong><br>
      Placa consultada: ${criterio}<br>
      ${errorMensaje}
    `;
  }, {
    criterio: criterioBusqueda,
    errorMensaje: mensaje
  });
};

const limpiarMensajeErrorEnPantalla = async (frame) => {
  await frame.evaluate(() => {
    document.querySelector('#codex_axis_error_box')?.remove();
  }).catch(() => null);
};

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const esperarMotorAxis = async (frame) => {
  const start = Date.now();

  while (Date.now() - start < AXIS_RECAPTCHA_WAIT_MS) {
    const disponible = await frame
      .evaluate(
        () =>
          Boolean(
            document.querySelector('#filtro_busqueda') &&
            document.querySelector('#valor_busqueda') &&
            globalThis.grecaptcha?.enterprise?.ready &&
            globalThis.grecaptcha?.enterprise?.execute
          )
      )
      .catch(() => false);

    if (disponible) return;
    await esperar(500);
  }

  throw new Error('reCAPTCHA enterprise no estuvo disponible a tiempo en AxisCloud.');
};

const runAxisQueued = async (task) => {
  const run = axisQueue.catch(() => null).then(task);
  axisQueue = run.catch(() => null);
  return run;
};

const consultarAxisDirecto = async (frame, criterioBusqueda) => {
  await limpiarMensajeErrorEnPantalla(frame);

  return frame.evaluate(
    async ({ criterio, siteKey }) => {
      const decodeJsonResponse = async (response) => {
        const buffer = await response.arrayBuffer();
        const text = new TextDecoder('iso-8859-1').decode(buffer);
        return JSON.parse(text);
      };

      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const getRecaptchaToken = async () => {
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          const enterprise = window.grecaptcha?.enterprise;

          if (enterprise?.ready && enterprise?.execute) {
            return new Promise((resolve, reject) => {
              enterprise.ready(async () => {
                try {
                  const token = await enterprise.execute(siteKey, { action: 'search' });
                  resolve(token);
                } catch (error) {
                  reject(new Error(error?.message || String(error)));
                }
              });
            });
          }

          await wait(500);
        }

        throw new Error('reCAPTCHA enterprise no esta disponible en AxisCloud.');
      };

      const select = document.querySelector('#filtro_busqueda');
      if (select) {
        select.value = 'PLA';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const input = document.querySelector('#valor_busqueda');
      if (input) {
        input.value = criterio;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const token = await getRecaptchaToken();

      const searchPayload = {
        maked_obj: 'PLA',
        maked_obj_sec: criterio,
        maked_obj_thr: String(ps_empresa),
        token,
        sl_al_lag: String(gs_code),
        sl_al_lag2: String(gs_code2)
      };

      const searchResponse = await fetch('download_construction.jsp', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify(searchPayload),
        credentials: 'include'
      });

      const searchJson = await decodeJsonResponse(searchResponse);
      let cuentaJson = null;

      if (searchJson?.lsCodError === '0') {
        const params = new URLSearchParams({
          tipo_dato: 'psPlaca',
          dato: criterio,
          empr: String(ps_empresa)
        });

        const cuentaResponse = await fetch('getEstadoCta.jsp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
          },
          body: params.toString(),
          credentials: 'include'
        });

        cuentaJson = await decodeJsonResponse(cuentaResponse);
      }

      return {
        searchJson,
        cuentaJson
      };
    },
    {
      criterio: criterioBusqueda,
      siteKey: AXIS_RECAPTCHA_SITE_KEY
    }
  );
};

const renderAxisCapture = async (frame, criterioBusqueda, payload, cuentaPayload) => {
  await frame.evaluate(
    ({ criterio, searchPayload, cuentaJson }) => {
      const formatCurrency = (value) =>
        `$${(Number(value || 0) / 100).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`;

      const getValue = (entry) => {
        if (!entry || typeof entry !== 'object') return '';
        return entry.valor ?? entry.Valor ?? '';
      };

      const select = document.querySelector('#filtro_busqueda');
      if (select) {
        select.value = 'PLA';
      }

      const input = document.querySelector('#valor_busqueda');
      if (input) {
        input.value = criterio;
      }

      document.querySelector('#codex_axis_error_box')?.remove();
      document.querySelector('#codex_axis_mi_cuenta_capture')?.remove();

      const container = document.querySelector('div.container-fluid') || document.body;
      const reference = document.querySelector('#dv_informacion');

      const card = document.createElement('div');
      card.id = 'codex_axis_mi_cuenta_capture';
      card.style.maxWidth = '1280px';
      card.style.margin = '18px auto';
      card.style.border = '1px solid #cfd7e3';
      card.style.borderRadius = '18px';
      card.style.overflow = 'hidden';
      card.style.background = '#ffffff';
      card.style.boxShadow = '0 18px 44px rgba(15, 23, 42, 0.16)';
      card.style.fontFamily = 'Arial, sans-serif';

      const infoPlaca = searchPayload?.lsInfoPlaca || {};
      const placa = getValue(infoPlaca.PLACA) || criterio;
      const nombre = infoPlaca.nombres || 'Sin datos';
      const marca = getValue(infoPlaca.MARCA) || '-';
      const modelo = getValue(infoPlaca.MODELO) || '-';
      const anio = getValue(infoPlaca.ANIO) || '-';
      const rows = Array.isArray(cuentaJson?.laDeudaAxisCloud) ? cuentaJson.laDeudaAxisCloud : [];
      const totalInfracciones = rows.reduce((sum, row) => sum + (Number(row.liCantidad) || 0), 0);
      const totalPendiente = rows.reduce((sum, row) => sum + (Number(row.liTotalPendiente) || 0), 0);
      const errorAnt = cuentaJson?.lsErrorAnt || null;
      const mensajeError =
        cuentaJson?.lsError || cuentaJson?.lsMensaje || searchPayload?.lsError || null;

      if (cuentaJson?.lsCodError === '0') {
        const rowsHtml =
          rows.length > 0
            ? rows
                .map(
                  (row) => `
                    <tr>
                      <td style="padding: 16px 20px; border-bottom: 1px solid #e7edf4; font-weight: 700; color: #1f2937;">${row.lsEmpresa || '-'}</td>
                      <td style="padding: 16px 20px; border-bottom: 1px solid #e7edf4; text-align: center; color: #1f2937;">${Number(row.liCantidad || 0)}</td>
                      <td style="padding: 16px 20px; border-bottom: 1px solid #e7edf4; text-align: right; color: #1f2937;">${formatCurrency(row.liTotalPendiente)}</td>
                    </tr>
                  `
                )
                .join('')
            : `
              <tr>
                <td colspan="3" style="padding: 18px 20px; text-align: center; color: #475569;">
                  No se encontraron valores en Mi Cuenta.
                </td>
              </tr>
            `;

        card.innerHTML = `
          <div style="background: #6b7280; color: white; padding: 20px 28px; display: flex; justify-content: space-between; gap: 18px; align-items: center; font-size: 19px; font-weight: 700;">
            <div>ESTADO DE CUENTA - PLA - ${placa}</div>
            <div>INFRACCIONES (${totalInfracciones})</div>
            <div>TOTAL: ${formatCurrency(totalPendiente)}</div>
          </div>
          <div style="padding: 20px 28px 10px; background: #f8fbff; border-bottom: 1px solid #e2e8f0;">
            <div style="display: flex; gap: 18px; flex-wrap: wrap; color: #334155; font-size: 14px;">
              <div><strong>Propietario:</strong> ${nombre}</div>
              <div><strong>Marca:</strong> ${marca}</div>
              <div><strong>Modelo:</strong> ${modelo}</div>
              <div><strong>Año:</strong> ${anio}</div>
            </div>
          </div>
          <div style="padding: 0 28px 28px; background: white;">
            <table style="width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 16px;">
              <thead>
                <tr>
                  <th style="text-align: left; padding: 12px 20px; border-bottom: 3px solid #1f2937; color: #111827;">Institución</th>
                  <th style="text-align: center; padding: 12px 20px; border-bottom: 3px solid #1f2937; color: #111827;">Cantidad</th>
                  <th style="text-align: right; padding: 12px 20px; border-bottom: 3px solid #1f2937; color: #111827;">Valor</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            ${
              errorAnt
                ? `<div style="margin-top: 22px; padding-top: 18px; border-top: 3px solid #cbd5e1; color: #ef4444; font-size: 15px; font-weight: 700;">Error: ${errorAnt}</div>`
                : ''
            }
          </div>
        `;
      } else {
        card.innerHTML = `
          <div style="padding: 22px 24px; background: #fff1f2; border-left: 6px solid #dc2626; color: #7f1d1d;">
            <div style="font-size: 20px; font-weight: 800; margin-bottom: 10px;">Respuesta del proveedor</div>
            <div style="font-size: 16px; margin-bottom: 6px;"><strong>Placa:</strong> ${placa}</div>
            <div style="font-size: 16px; margin-bottom: 6px;"><strong>Propietario:</strong> ${nombre}</div>
            <div style="font-size: 16px;">${mensajeError || 'No fue posible consultar Mi Cuenta en AxisCloud.'}</div>
          </div>
        `;
      }

      if (reference && reference.parentNode) {
        reference.parentNode.insertBefore(card, reference);
      } else {
        container.prepend(card);
      }

      card.scrollIntoView({
        behavior: 'auto',
        block: 'center',
        inline: 'center'
      });
    },
    {
      criterio: criterioBusqueda,
      searchPayload: payload,
      cuentaJson: cuentaPayload
    }
  );
};

const clickVisibleOkInContext = async (context) => {
  return context.evaluate(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const swalConfirm =
      document.querySelector('button.swal2-confirm') ||
      document.querySelector('.swal2-actions button');

    if (swalConfirm && isVisible(swalConfirm)) {
      swalConfirm.click();
      return true;
    }

    const candidates = Array.from(
      document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')
    );

    const okButton = candidates.find((element) => {
      const text = (element.innerText || element.value || '').replace(/\s+/g, ' ').trim().toUpperCase();
      return ['OK', 'ACEPTAR'].includes(text) && isVisible(element);
    });

    if (!okButton) return false;

    okButton.click();
    return true;
  }).catch(() => false);
};

const cerrarPopupOkSiExiste = async (page, frame) => {
  const clickedInFrame = await clickVisibleOkInContext(frame);
  if (clickedInFrame) {
    await frame.waitForTimeout(800);
    return true;
  }

  const clickedInPage = await clickVisibleOkInContext(page);
  if (clickedInPage) {
    await page.waitForTimeout(800);
    return true;
  }

  return false;
};

const buscarPlacaAxis = async (page, frame, criterioBusqueda) => {
  await limpiarMensajeErrorEnPantalla(frame);
  await frame.locator('#filtro_busqueda').selectOption('PLA');
  const inputBusqueda = frame.locator('#valor_busqueda');

  await inputBusqueda.click();
  await inputBusqueda.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await inputBusqueda.press('Backspace');
  await inputBusqueda.type(criterioBusqueda, { delay: 90 });
  await inputBusqueda.press('Tab');

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('download_construction.jsp') &&
      response.request().method() === 'POST' &&
      (response.request().postData() || '').includes(`"maked_obj_sec":"${criterioBusqueda}"`),
    { timeout: 45000 }
  );

  await frame.locator('#boton_buscar').click();
  const response = await responsePromise;

  return response.json();
};

const marcarContenedorMiCuenta = async (frame) => {
  return frame.evaluate(() => {
    const previous = document.querySelector('#codex_axis_mi_cuenta_capture');
    if (previous) previous.removeAttribute('id');

    const isVisible = (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0 &&
        rect.width > 220 &&
        rect.height > 120
      );
    };

    const candidates = Array.from(
      document.querySelectorAll('div, section, article, main, table')
    );

    let bestElement = null;
    let bestArea = Number.POSITIVE_INFINITY;

    for (const element of candidates) {
      const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
      if (!/ESTADO DE CUENTA|Infracciones registradas|Ver detalle|TOTAL: \$/.test(text)) {
        continue;
      }

      if (!isVisible(element)) continue;

      const rect = element.getBoundingClientRect();
      const area = rect.width * rect.height;

      if (area < bestArea) {
        bestArea = area;
        bestElement = element;
      }
    }

    if (bestElement) {
      bestElement.id = 'codex_axis_mi_cuenta_capture';
      bestElement.scrollIntoView({
        behavior: 'auto',
        block: 'center',
        inline: 'center'
      });
      return true;
    }

    return false;
  });
};

const abrirMiCuentaAxis = async (page, frame, criterioBusqueda) => {
  const botonMiCuenta = frame.locator('#estado_cta');
  const visible = await botonMiCuenta
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false);

  if (!visible) {
    return buildEmptyMiCuenta(
      criterioBusqueda,
      'No se encontro el boton Mi Cuenta despues de la busqueda.'
    );
  }

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('getEstadoCta.jsp') &&
      response.request().method() === 'POST',
    { timeout: 30000 }
  );

  await botonMiCuenta.click();

  const response = await responsePromise;
  const payload = await response.json();

  await frame.waitForTimeout(1200);
  await marcarContenedorMiCuenta(frame).catch(() => false);

  return buildAxisMiCuentaData(payload, criterioBusqueda);
};

const abrirFrameAxis = async (page, siteUrl) => {
  await page.goto(siteUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  const iframe = page.locator('#iframe_descripcion');
  await iframe.waitFor({ state: 'attached', timeout: 30000 }).catch(() => null);

  const iframeHandle = await iframe.elementHandle();
  const iframeFrame = iframeHandle ? await iframeHandle.contentFrame() : null;

  if (iframeFrame) {
    await iframeFrame.waitForSelector('#filtro_busqueda', { timeout: 30000 });
    return iframeFrame;
  }

  await page.goto(DIRECT_AXIS_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  await page.waitForSelector('#filtro_busqueda', { timeout: 30000 });
  return page.mainFrame();
};

const iniciarSesionAxis = async (browser, siteUrl) => {
  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 2600
    }
  });

  const page = await context.newPage();
  const frame = await abrirFrameAxis(page, siteUrl);

  return { context, page, frame };
};

module.exports = async ({ browser, placa, site, id_orden, output_key }) =>
  runAxisQueued(async () => {
    const criterioBusqueda = normalizeText(`${placa || ''}`).toUpperCase();

    if (!criterioBusqueda) {
      throw new Error('Debe enviar una placa valida para la consulta AxisCloud.');
    }

    console.log(`🟢 Iniciando consulta AXISCLOUD para placa ${criterioBusqueda}`);

    let context;
    let page;
    let frame;

    try {
      ({ context, page, frame } = await iniciarSesionAxis(browser, site.url));
      let miCuenta = null;
      let payload = null;
      let cuentaPayload = null;

      for (let attempt = 1; attempt <= AXIS_SEARCH_MAX_ATTEMPTS; attempt += 1) {
        console.log(`🔁 AXISCLOUD intento ${attempt}/${AXIS_SEARCH_MAX_ATTEMPTS} para ${criterioBusqueda}`);

        try {
          await esperarMotorAxis(frame);
          const resultado = await consultarAxisDirecto(frame, criterioBusqueda);
          payload = resultado.searchJson;
          cuentaPayload = resultado.cuentaJson;

          if (payload?.lsCodError === '0' && cuentaPayload?.lsCodError === '0') {
            miCuenta = buildAxisMiCuentaData(cuentaPayload, criterioBusqueda);
            await renderAxisCapture(frame, criterioBusqueda, payload, cuentaPayload);
            break;
          }

          if (payload?.lsCodError === '0') {
            const mensajeMiCuenta =
              normalizeScalar(cuentaPayload?.lsError ?? cuentaPayload?.lsMensaje) ||
              'No se pudo consultar Mi Cuenta.';

            miCuenta = buildEmptyMiCuenta(
              criterioBusqueda,
              mensajeMiCuenta,
              normalizeScalar(cuentaPayload?.lsCodError)
            );

            await renderAxisCapture(frame, criterioBusqueda, payload, cuentaPayload);

            if (attempt === AXIS_SEARCH_MAX_ATTEMPTS || !isRetryableAxisError(cuentaPayload)) {
              break;
            }
          } else {
            miCuenta = buildEmptyMiCuenta(
              criterioBusqueda,
              'Mi Cuenta no se consulto porque la respuesta inicial no fue exitosa.',
              normalizeScalar(payload?.lsCodError)
            );

            await mostrarMensajeErrorEnPantalla(
              frame,
              criterioBusqueda,
              payload?.lsError || payload?.lsMensaje || 'No fue posible completar la consulta en AxisCloud.'
            );

            if (attempt === AXIS_SEARCH_MAX_ATTEMPTS || !isRetryableAxisError(payload)) {
              break;
            }
          }
        } catch (error) {
          console.warn(`⚠️ AXISCLOUD intento ${attempt} fallo: ${error.message}`);

          if (attempt === AXIS_SEARCH_MAX_ATTEMPTS) {
            payload = {
              lsCodError: 'LOCAL_ERROR',
              lsError: `No se pudo completar la consulta en AxisCloud: ${error.message}`
            };
            miCuenta = buildEmptyMiCuenta(
              criterioBusqueda,
              `No se pudo abrir Mi Cuenta: ${error.message}`,
              'LOCAL_ERROR'
            );
            await mostrarMensajeErrorEnPantalla(frame, criterioBusqueda, payload.lsError).catch(() => null);
            break;
          }

          await context.close().catch(() => null);
        }

        if (attempt < AXIS_SEARCH_MAX_ATTEMPTS) {
          await context.close().catch(() => null);
          await esperar(AXIS_RETRY_WAIT_MS);
          ({ context, page, frame } = await iniciarSesionAxis(browser, site.url));
        }
      }

      await frame.waitForTimeout(1500);

      const datos = buildAxisData(payload, criterioBusqueda, miCuenta);

      const { dir } = ensureScreenshotDir({
        baseDir: __dirname,
        placa,
        id_orden,
        output_key
      });

      const filename = `${site.key}.png`;
      const filePath = path.join(dir, filename);

      await capturarBloqueAxis(page, frame, filePath);

      console.log('📦 AXISCLOUD JSON');
      console.log(JSON.stringify(datos, null, 2));

      await context.close();

      console.log('📸 Captura AXISCLOUD guardada');

      return {
        fuente: site.key,
        filename,
        descripcion: `Captura automatica del sitio ${site.key}`,
        datos
      };
    } catch (error) {
      await context?.close().catch(() => null);
      throw error;
    }
  });
