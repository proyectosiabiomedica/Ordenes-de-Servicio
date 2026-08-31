
/**
 * ORDEN DE TRABAJO · IA BIOMÉDICA
 * Proxy entre la app web (GitHub Pages) y la API de Jotform.
 * La API Key vive aquí, nunca en el navegador.
 *
 * Implementar como: Aplicación web · Ejecutar como YO · Acceso: CUALQUIER USUARIO
 */

var CONFIG = {
  API_KEY: '16d09cdc5bdb9c97c5a1b888007a783e',
  FORM_ID: '260445478825062',
  // Debe ser idéntico al TOKEN del index.html
  TOKEN: 'aiiPlCWrNHmMcqLQRrj9RK2QVnqfxSMzPYISzJ88dXNjB8Ys',
  // Carpeta de Drive donde se guardan las fotos ('' = crea una llamada "Evidencia OT")
  DRIVE_FOLDER_ID: '',
  // true = adjunta las fotos al campo "Carga de archivo" del formulario.
  //        Si Jotform rechaza el adjunto, caen solas a Drive con sus enlaces en OBSERVACIONES.
  // false = siempre a Drive.
  ADJUNTAR_EN_JOTFORM: true,
  // 'formulario' = envía por el mismo endpoint que usa el formulario público.
  //                Dispara notificaciones, PDF, condiciones e integraciones. RECOMENDADO.
  // 'api'        = envía por la API. Más limpio de depurar, pero Jotform NO dispara
  //                correos ni integraciones en las submissions creadas por API.
  MODO_ENVIO: 'formulario',
  // Formato del widget Matrix Dinámica (Valores de Medición).
  // 'json'     = [["fila1col1","fila1col2",...],["fila2col1",...]]
  // 'objetos'  = [{"Medicion":"...","Valor Programado":"..."}, ...]
  // 'texto'    = renglones separados por salto de línea
  // Confirme el correcto con verFormatoMediciones() y déjelo fijo aquí.
  // CONFIRMADO en los envíos reales: arreglo de objetos con los encabezados como llaves.
  FORMATO_MATRIZ: 'objetos',
  // Respaldo por API. DESACTIVADO a propósito: por API la orden queda registrada
  // pero Jotform no dispara notificaciones, PDF ni flujos. Es preferible que el
  // envío falle de forma visible y la orden se quede en la cola del celular,
  // a que entre a medias y nadie se entere. No activar sin una buena razón.
  RESPALDO_API: false,
  // Hoja opcional de bitácora de envíos ('' = desactivada)
  // Hoja de bitácora del proxy: pestañas "Bitacora OT" y "Diagnostico OT".
  SHEET_ID: '1_Q1wOlYz1gR9CUYYZkOX1qaIh-Tl_YTml67tdNF-VVY',
  // Hoja que alimenta Jotform con cada envío. De aquí se lee "Mis envíos".
  ENVIOS_SHEET_ID: '1CdyrKa2f6w-3-0l587t46B_rW3u3X-OOCUaNLk2ij2I',
  ENVIOS_TAB: 'Form Responses',
  // Pestaña de avisos para los ingenieros, dentro de SHEET_ID. Se llena a mano.
  AVISOS_TAB: 'Avisos',
  // Conversaciones por orden o equipo, dentro de SHEET_ID.
  CHAT_TAB: 'Chat',
  // Perfil que coordina la comunicación. Entra con PIN y ve todas las conversaciones.
  COORDINADOR: 'Proyectos IA Biomédica',
  // Sal larga y aleatoria. Cambiarla invalida el PIN vigente.
  SAL_PIN: 'aiiPlCWrNHmMcqLQRrj9RK2QVnqfxSMzPYISzJ88dXNjB8Ys',
  // Resultado de generarHashPin('1234'). Nunca guardar el PIN en claro.
  PIN_COORDINADOR: 'dc2912f85d0f113df293877916ff072c3faa719f053f6f4f14d16a9e91711589'
};

var API = 'https://api.jotform.com';

/* Diario del envío en curso. Se escribe en la hoja SHEET_ID, pestaña "Diagnostico",
   para no depender del panel de Ejecuciones. */
var DIARIO = [];
function anota(t) { DIARIO.push(t); Logger.log(t); }

function guardarDiario(subID, resultado) {
  if (!CONFIG.SHEET_ID || !DIARIO.length) return;
  try {
    var libro = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var hoja = libro.getSheetByName('Diagnostico OT') || libro.insertSheet('Diagnostico OT');
    if (hoja.getLastRow() === 0) hoja.appendRow(['Fecha', 'SubmissionID', 'Resultado', 'Detalle del envío']);
    hoja.appendRow([new Date(), subID || '', resultado || '', DIARIO.join('\n')]);
    hoja.setColumnWidth(4, 600);
  } catch (e) { Logger.log('No se pudo escribir el diario: ' + e.message); }
  DIARIO = [];
}

/**
 * Devuelve la API Key limpia de espacios, tabuladores y saltos de línea.
 * Pegar la llave desde Jotform suele arrastrar un tabulador invisible que
 * hace fallar UrlFetchApp con "Invalid argument".
 */
function llave() {
  return encodeURIComponent(String(CONFIG.API_KEY).replace(/\s+/g, ''));
}

/* ============================ ENTRADAS ============================ */

function doGet(e) {
  var p = e.parameter || {};
  var out;
  try {
    verificarToken(p.token);
    if (p.action === 'ping') out = { ok: true, hora: new Date().toISOString() };
    else if (p.action === 'schema') out = { ok: true, questions: obtenerPreguntas(true) };
    else if (p.action === 'submissions') out = { ok: true, items: listarEnvios(p.ingeniero, Number(p.limit || 500)) };
    else if (p.action === 'detalle') out = { ok: true, respuestas: detalleEnvio(p.fila) };
    else if (p.action === 'avisos') out = { ok: true, avisos: listarAvisos(p.ingeniero, p.sesion) };
    else if (p.action === 'login') out = iniciarSesion(p.pin);
    else if (p.action === 'chatHilos') out = { ok: true, hilos: chatHilos(p.ingeniero, p.sesion) };
    else if (p.action === 'chatMensajes') out = { ok: true, mensajes: chatMensajes(p.clave, Number(p.desde || 0)) };
    else out = { ok: false, error: 'Acción no reconocida: ' + p.action };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return responder(out, p.callback);
}

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    verificarToken(body.token);
    if (body.action === 'chatEnviar') out = chatEnviar(body);
    else if (body.action === 'avisoGuardar') out = guardarAviso(body);
    else if (body.action === 'submit') out = enviarOrden(body);
    else throw new Error('Acción no reconocida');
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function verificarToken(t) {
  if (!CONFIG.TOKEN || t !== CONFIG.TOKEN) throw new Error('Token inválido');
}

function responder(obj, callback) {
  var txt = JSON.stringify(obj);
  if (callback) return ContentService.createTextOutput(callback + '(' + txt + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(txt).setMimeType(ContentService.MimeType.JSON);
}

/* ============================ ESQUEMA ============================ */

function obtenerPreguntas(usarCache) {
  var cache = CacheService.getScriptCache();
  if (usarCache) {
    var c = cache.get('preguntas');
    if (c) return JSON.parse(c);
  }
  var r = UrlFetchApp.fetch(API + '/form/' + CONFIG.FORM_ID + '/questions?apiKey=' + llave(),
    { muteHttpExceptions: true });
  var d = JSON.parse(r.getContentText());
  if (d.responseCode !== 200) throw new Error('Jotform respondió ' + d.responseCode + ': ' + (d.message || ''));
  try { cache.put('preguntas', JSON.stringify(d.content), 21600); } catch (e) {}
  return d.content;
}

function buscarQid(preguntas, textoBuscado) {
  var objetivo = normalizar(textoBuscado);
  for (var k in preguntas) {
    if (normalizar(preguntas[k].text) === objetivo) return k;
  }
  for (var k2 in preguntas) {
    if (normalizar(preguntas[k2].text).indexOf(objetivo) === 0) return k2;
  }
  return null;
}

function normalizar(s) {
  return String(s || '').toUpperCase()
    .replace(/[ÁÀÄÂ]/g, 'A').replace(/[ÉÈËÊ]/g, 'E').replace(/[ÍÌÏÎ]/g, 'I')
    .replace(/[ÓÒÖÔ]/g, 'O').replace(/[ÚÙÜÛ]/g, 'U').replace(/Ñ/g, 'N')
    .replace(/\s+/g, ' ').trim().replace(/[:.]+$/, '');
}

/* ============================ ENVÍO ============================ */

function enviarOrden(body) {
  var preguntas = obtenerPreguntas(true);
  var answers = body.answers || {};
  var payload = {};

  // 1. Serializar cada respuesta según el tipo real de la pregunta
  for (var qid in answers) {
    var q = preguntas[qid];
    var a = answers[qid];
    if (!q || a == null) continue;
    serializar(payload, qid, q, a);
  }

  corregirOpciones(payload, preguntas);

  // 2. Preparar las fotos como archivos
  var fotos = body.fotos || [];
  var blobs = [];
  for (var i = 0; i < fotos.length; i++) {
    var f = fotos[i];
    var partes = String(f.dataUrl).split(',');
    if (partes.length < 2) continue;
    var nombre = (f.nombre || ('foto_' + (i + 1))).replace(/\.[^.]+$/, '');
    blobs.push(Utilities.newBlob(Utilities.base64Decode(partes[1]), 'image/jpeg',
      nombre + '_' + (i + 1) + '.jpg'));
  }

  // 3. Intento A: adjuntarlas al campo "Carga de archivo" del formulario
  if (blobs.length && CONFIG.ADJUNTAR_EN_JOTFORM && body.campoFotos) {
    var conArchivos = {};
    for (var k in payload) conArchivos[k] = payload[k];
    var qFoto = preguntas[body.campoFotos];
    var campo = qFoto ? nombreCampo(body.campoFotos, qFoto) : 'submission[' + body.campoFotos + ']';
    if (CONFIG.MODO_ENVIO === 'formulario') conArchivos[campo + '[]'] = blobs;
    else if (blobs.length === 1) conArchivos[campo] = blobs[0];
    else for (var j = 0; j < blobs.length; j++) conArchivos[campo + '[' + j + ']'] = blobs[j];

    camposAutomaticos(conArchivos, preguntas);
    var faltanA = obligatoriosFaltantes(conArchivos, preguntas);
    if (faltanA.length) {
      var avisoA = 'Faltan campos obligatorios del formulario: ' + faltanA.join(', ');
      anota(avisoA); guardarDiario('', 'FALLÓ: ' + avisoA); throw new Error(avisoA);
    }
    var intento = postJotform(conArchivos);
    if (intento.ok) {
      bitacora(intento.id, body, ['(adjuntas en Jotform: ' + blobs.length + ')']);
      guardarDiario(intento.id, 'OK · ' + (intento.via || ''));
      return { ok: true, submissionID: intento.id, fotos: blobs.length, destino: 'jotform',
               via: intento.via, aviso: intento.aviso };
    }
    anota('Falló el envío con adjuntos: ' + intento.detalle);
    if (qFoto && String(qFoto.required) === 'Yes') {
      // Mandarlo por Drive dejaría vacío un campo obligatorio y Jotform lo rechazaría
      // igual, pero con un mensaje que no dice nada. Mejor devolver la causa real.
      var causa = 'No se pudieron adjuntar las fotos y "' + (qFoto.text || 'Carga de archivo') +
        '" es obligatorio. Motivo: ' + intento.detalle;
      guardarDiario('', 'FALLÓ: ' + causa);
      throw new Error(causa);
    }
    anota('Se usará Drive para las fotos.');
  }

  // 4. Intento B: subirlas a Drive y anexar los enlaces en OBSERVACIONES
  var enlaces = [];
  if (blobs.length) {
    var carpeta = obtenerCarpeta();
    for (var b = 0; b < blobs.length; b++) {
      var archivo = carpeta.createFile(blobs[b]);
      archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      enlaces.push(archivo.getUrl());
    }
    var qObs = buscarQid(preguntas, 'OBSERVACIONES:');
    if (qObs) {
      var claveObs = nombreCampo(qObs, preguntas[qObs]);
      var previo = payload[claveObs] || '';
      payload[claveObs] = (previo ? previo + '\n\n' : '') +
        'EVIDENCIA FOTOGRÁFICA:\n' + enlaces.join('\n');
    }
  }

  camposAutomaticos(payload, preguntas);

  var faltan = obligatoriosFaltantes(payload, preguntas);
  if (faltan.length) {
    var aviso = 'Faltan campos obligatorios del formulario: ' + faltan.join(', ');
    anota(aviso);
    guardarDiario('', 'FALLÓ: ' + aviso);
    throw new Error(aviso);
  }

  var envio = postJotform(payload);
  if (!envio.ok) { guardarDiario('', 'FALLÓ: ' + envio.detalle); throw new Error('Jotform rechazó el envío: ' + envio.detalle); }

  bitacora(envio.id, body, enlaces);
  guardarDiario(envio.id, 'OK · ' + (envio.via || ''));
  return { ok: true, submissionID: envio.id, fotos: enlaces.length,
           destino: enlaces.length ? 'drive' : 'sin fotos', via: envio.via, aviso: envio.aviso };
}

/**
 * Campos marcados como obligatorios en Jotform que no vienen en el envío.
 * Sin esta revisión, Jotform responde "Incomplete Values - Go Back and Fix",
 * que no dice cuál campo falta.
 */
function obligatoriosFaltantes(payload, preguntas) {
  var faltan = [];
  var invalidos = valoresInvalidos(payload, preguntas);
  for (var v = 0; v < invalidos.length; v++) faltan.push(invalidos[v]);
  for (var qid in preguntas) {
    var q = preguntas[qid];
    if (String(q.required) !== 'Yes') continue;
    if (NO_CAPTURAN_GS.indexOf(q.type) > -1) continue;

    var base = nombreCampo(qid, q);
    var hay = false;
    for (var clave in payload) {
      if (clave !== base && clave.indexOf(base + '[') !== 0) continue;
      var v = payload[clave];
      var lista = (Object.prototype.toString.call(v) === '[object Array]') ? v : [v];
      for (var i = 0; i < lista.length; i++) {
        if (lista[i] && typeof lista[i].getBytes === 'function') { hay = true; break; }
        if (lista[i] !== null && lista[i] !== undefined && String(lista[i]).trim() !== '') { hay = true; break; }
      }
      if (hay) break;
    }
    if (!hay) faltan.push(q.text || q.name || ('qid ' + qid));
  }
  return faltan;
}

var NO_CAPTURAN_GS = ['control_head', 'control_text', 'control_button', 'control_pagebreak',
  'control_collapse', 'control_divider', 'control_image'];

/**
 * Ajusta los valores que solo difieren de la opción real en espacios, tabuladores
 * o acentos, y los deja idénticos a los del formulario. Jotform compara carácter
 * por carácter: una opción como "INCUBADORA (<tab>C, ...)" se rechaza si llega con
 * un espacio en lugar del tabulador. Esto rescata borradores y órdenes en cola
 * guardados con valores anteriores.
 */
function corregirOpciones(payload, preguntas) {
  for (var qid in preguntas) {
    var q = preguntas[qid];
    if (q.type !== 'control_dropdown' && q.type !== 'control_radio' && q.type !== 'control_checkbox') continue;
    var ops = String(q.options || '').split('|');
    var limpias = [];
    for (var o = 0; o < ops.length; o++) if (ops[o].trim() !== '') limpias.push(ops[o]);
    if (!limpias.length) continue;

    var base = nombreCampo(qid, q);
    for (var clave in payload) {
      if (clave !== base && clave !== base + '[]' && clave.indexOf(base + '[') !== 0) continue;
      var v = payload[clave];
      var esArreglo = (Object.prototype.toString.call(v) === '[object Array]');
      var lista = esArreglo ? v : [v];
      var corregida = [];
      for (var i = 0; i < lista.length; i++) {
        var valor = String(lista[i] == null ? '' : lista[i]);
        var exacto = null, aproximado = null;
        for (var j = 0; j < limpias.length; j++) {
          if (limpias[j] === valor) { exacto = limpias[j]; break; }
          if (normalizar(limpias[j]) === normalizar(valor)) aproximado = limpias[j];
        }
        if (!exacto && aproximado) {
          anota('Corregido "' + valor.replace(/\s+/g, ' ') + '" → opción exacta de ' + (q.text || q.name));
          corregida.push(aproximado);
        } else {
          corregida.push(exacto || valor);
        }
      }
      payload[clave] = esArreglo ? corregida : corregida[0];
    }
  }
}

/**
 * Valores que no están entre las opciones del formulario. Jotform los rechaza
 * con "Incomplete Values", igual que si el campo viniera vacío, sin decir cuál es.
 */
function valoresInvalidos(payload, preguntas) {
  var malos = [];
  for (var qid in preguntas) {
    var q = preguntas[qid];
    if (q.type !== 'control_dropdown' && q.type !== 'control_radio' && q.type !== 'control_checkbox') continue;
    var ops = String(q.options || '').split('|');
    var limpias = [];
    for (var o = 0; o < ops.length; o++) if (ops[o].trim() !== '') limpias.push(ops[o].trim());
    if (!limpias.length) continue;

    var base = nombreCampo(qid, q);
    for (var clave in payload) {
      if (clave !== base && clave !== base + '[]' && clave.indexOf(base + '[') !== 0) continue;
      var v = payload[clave];
      var lista = (Object.prototype.toString.call(v) === '[object Array]') ? v : [v];
      for (var i = 0; i < lista.length; i++) {
        var valor = String(lista[i] == null ? '' : lista[i]).trim();
        if (valor === '') continue;
        var esta = false;
        for (var j = 0; j < limpias.length; j++) if (limpias[j] === valor) { esta = true; break; }
        if (!esta) {
          malos.push('"' + valor + '" no es una opción válida de ' + (q.text || q.name));
        }
      }
    }
  }
  return malos;
}

/**
 * Rellena los widgets que el formulario genera solo al abrirse, como el folio único.
 * Sin esto la orden llega sin número de referencia.
 */
function camposAutomaticos(payload, preguntas) {
  for (var qid in preguntas) {
    var q = preguntas[qid];
    if (String(q.name || '').toLowerCase().indexOf('idunico') === -1) continue;
    var clave = nombreCampo(qid, q);
    if (!payload[clave]) payload[clave] = 'IAB-' + Math.floor(10000 + Math.random() * 90000);
  }
}

/** Único punto de salida hacia Jotform. */
function postJotform(payload) {
  return CONFIG.MODO_ENVIO === 'formulario' ? postFormulario(payload) : postApi(payload);
}

/**
 * Envío por el endpoint público, idéntico a llenar el formulario a mano.
 * Es la única vía que dispara notificaciones, PDF adjunto, condiciones e integraciones:
 * Jotform no las ejecuta en las submissions creadas por la API.
 */
function postFormulario(payload) {
  var marca = Date.now();
  payload.formID = CONFIG.FORM_ID;
  // Protección antispam. El HTML publica el valor sin sufijo, pero un script del
  // propio formulario lo reescribe a "formID-formID" antes de enviar. Si llega
  // con el valor del HTML, Jotform responde con el captcha y descarta la orden.
  payload.simple_spc = CONFIG.FORM_ID + '-' + CONFIG.FORM_ID;
  payload.website = '';
  payload.submitSource = 'form';
  payload.buildDate = String(marca);
  payload.jsExecutionTracker = 'build-date-' + marca;
  payload.submitDate = String(marca);
  payload.uploadServerUrl = 'https://upload.jotform.com/upload';
  payload.eventObserver = '1';

  registrarPayload(payload);

  // Jotform atiende el POST pero no lo registra si no viene de un navegador:
  // sin estas cabeceras responde 200 con una página que no es confirmación.
  var origen = 'https://form.jotform.com';
  var cabeceras = {
    'Referer': origen + '/' + CONFIG.FORM_ID,
    'Origin': origen,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-MX,es;q=0.9'
  };

  var opciones;
  if (tieneArchivos(payload)) {
    var m = armarMultipart(payload);
    opciones = { method: 'post', contentType: 'multipart/form-data; boundary=' + m.frontera,
      payload: m.cuerpo, headers: cabeceras, muteHttpExceptions: true, followRedirects: true };
  } else {
    var cadena = armarUrlencoded(payload);
    anota('Cuerpo urlencoded: ' + cadena.length + ' caracteres');
    opciones = { method: 'post', contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
      payload: cadena, headers: cabeceras, muteHttpExceptions: true, followRedirects: true };
  }

  var rutas = [
    'https://submit.jotform.com/submit/' + CONFIG.FORM_ID,
    'https://www.jotform.com/submit/' + CONFIG.FORM_ID
  ];
  var ultimo = '';
  var idPrevio = ultimoEnvio();          // referencia para comprobar que sí se guardó
  anota('Último envío antes de mandar: ' + idPrevio);

  for (var i = 0; i < rutas.length; i++) {
    var r;
    try { r = UrlFetchApp.fetch(rutas[i], opciones); }
    catch (e) { ultimo = rutas[i] + ' → ' + e.message; anota(ultimo); continue; }

    var code = r.getResponseCode();
    var txt = r.getContentText();
    anota('Envío por ' + rutas[i] + ' → HTTP ' + code + ' (' + txt.length + ' caracteres)');

    if (code !== 200 && code !== 302) {
      ultimo = rutas[i] + ' → HTTP ' + code + ': ' + limpiarHtml(txt);
      anota('  respuesta: ' + limpiarHtml(txt));
      continue;
    }
    if (txt.indexOf('form_error') > -1 || txt.indexOf('There was an error') > -1) {
      ultimo = rutas[i] + ' → datos rechazados: ' + limpiarHtml(txt);
      anota('  respuesta: ' + limpiarHtml(txt));
      continue;
    }
    // Un 200 no garantiza nada: hay que verificar que apareció una submission nueva.
    var m2 = txt.match(/submission[_-]?id["'\s:=]+(\d{10,})/i) || txt.match(/sid["'\s:=]+(\d{10,})/i);
    if (m2) return { ok: true, id: m2[1], via: rutas[i] };

    // La API tarda en reflejar el envío recién hecho: se consulta varias veces
    // antes de darlo por fallido, para no rechazar una orden que sí entró.
    var idNuevo = '';
    for (var intentoVer = 0; intentoVer < 4; intentoVer++) {
      Utilities.sleep(2500);
      idNuevo = ultimoEnvio();
      if (idNuevo && idNuevo !== idPrevio) break;
    }
    if (idNuevo && idNuevo !== idPrevio) {
      anota('Confirmado: se registró la submission ' + idNuevo);
      return { ok: true, id: idNuevo, via: rutas[i] };
    }
    ultimo = rutas[i] + ' → HTTP 200 pero la orden NO quedó registrada';
    anota('  ' + ultimo);
    anota('  respuesta: ' + limpiarHtml(txt));
    continue;
  }

  if (CONFIG.RESPALDO_API) {
    anota('AVISO: falló el envío por formulario (' + ultimo + '). Va por API, SIN correos.');
    var res = postApi(payloadParaApi(payload));
    if (res.ok) { res.via = 'api'; res.aviso = 'Enviada por API: no se dispararon los correos ni el PDF.'; }
    return res;
  }
  anota('El envío no entró. La orden permanece en la cola del dispositivo.');
  return { ok: false, detalle: ultimo };
}

function tieneArchivos(payload) {
  for (var k in payload) {
    var v = payload[k];
    var lista = (Object.prototype.toString.call(v) === '[object Array]') ? v : [v];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i] && typeof lista[i].getBytes === 'function') return true;
    }
  }
  return false;
}

/** Cuerpo urlencoded con llaves repetidas, tal cual lo manda un formulario HTML. */
function armarUrlencoded(payload) {
  var partes = [];
  for (var clave in payload) {
    var v = payload[clave];
    var lista = (Object.prototype.toString.call(v) === '[object Array]') ? v : [v];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i] === null || lista[i] === undefined) continue;
      partes.push(encodeURIComponent(clave) + '=' + encodeURIComponent(String(lista[i])));
    }
  }
  return partes.join('&');
}

/** Saca el texto legible de una página de error de Jotform. */
function limpiarHtml(txt) {
  var t = String(txt)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.slice(0, 500);
}

/**
 * Arma el cuerpo multipart/form-data reproduciendo el POST del navegador.
 * Un valor de tipo arreglo repite la misma llave, que es como Jotform espera
 * las casillas de verificación y los archivos múltiples.
 */
function armarMultipart(payload) {
  var frontera = '----otIA' + Date.now();
  var trozos = [];

  function texto(t) { return Utilities.newBlob(t).getBytes(); }
  function campo(clave, valor) {
    trozos.push(texto('--' + frontera + '\r\nContent-Disposition: form-data; name="' + clave + '"\r\n\r\n' + valor + '\r\n'));
  }
  function archivo(clave, blob) {
    trozos.push(texto('--' + frontera + '\r\nContent-Disposition: form-data; name="' + clave +
      '"; filename="' + blob.getName() + '"\r\nContent-Type: ' + blob.getContentType() + '\r\n\r\n'));
    trozos.push(blob.getBytes());
    trozos.push(texto('\r\n'));
  }

  for (var clave in payload) {
    var v = payload[clave];
    var lista = (Object.prototype.toString.call(v) === '[object Array]') ? v : [v];
    for (var i = 0; i < lista.length; i++) {
      var item = lista[i];
      if (item && typeof item.getBytes === 'function') archivo(clave, item);
      else if (item !== null && item !== undefined) campo(clave, String(item));
    }
  }
  trozos.push(texto('--' + frontera + '--\r\n'));

  var total = 0, j;
  for (j = 0; j < trozos.length; j++) total += trozos[j].length;
  var bytes = [], k;
  for (j = 0; j < trozos.length; j++) for (k = 0; k < trozos[j].length; k++) bytes.push(trozos[j][k]);

  anota('Cuerpo multipart: ' + total + ' bytes');
  // El cuerpo debe entregarse como Blob: UrlFetchApp no acepta un arreglo de bytes
  // y lo convierte a texto, que era la causa del HTTP 400.
  return { frontera: frontera, cuerpo: Utilities.newBlob(bytes, 'multipart/form-data', 'orden') };
}

/** Deja en el registro lo que realmente se envía, para poder cotejar campo por campo. */
function registrarPayload(payload) {
  var lineas = [];
  for (var k in payload) {
    var v = payload[k];
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var partes = [];
      for (var i = 0; i < v.length; i++) {
        partes.push(v[i] && typeof v[i].getBytes === 'function' ? '[archivo ' + v[i].getName() + ']' : String(v[i]));
      }
      lineas.push(k + ' = ' + partes.join(' ++ '));
    } else if (v && typeof v.getBytes === 'function') {
      lineas.push(k + ' = [archivo ' + v.getName() + ']');
    } else {
      lineas.push(k + ' = ' + String(v).slice(0, 90));
    }
  }
  lineas.sort();
  anota('CAMPOS ENVIADOS (' + lineas.length + '):\n' + lineas.join('\n'));
}

/** Convierte las llaves qNN_nombre a submission[NN] para el respaldo por API. */
function payloadParaApi(payload) {
  var out = {};
  for (var k in payload) {
    if (k === 'formID' || k === 'simple_spc' || k === 'website') continue;
    var m = k.match(/^q(\d+)_[^\[\]]*(.*)$/);
    if (!m) { out[k] = payload[k]; continue; }
    var qid = m[1], resto = m[2] || '';
    resto = resto.replace(/^\[(month|day|year|hour|min|ampm)\]$/, '_$1');
    out[resto.indexOf('_') === 0
      ? 'submission[' + qid + resto + ']'
      : 'submission[' + qid + ']' + resto] = payload[k];
  }
  return out;
}

/** Envío por API. No dispara correos ni integraciones. */
function postApi(payload) {
  var r = UrlFetchApp.fetch(API + '/form/' + CONFIG.FORM_ID + '/submissions?apiKey=' + llave(),
    { method: 'post', payload: payload, muteHttpExceptions: true });
  var txt = r.getContentText();
  var d;
  try { d = JSON.parse(txt); } catch (e) { return { ok: false, detalle: 'HTTP ' + r.getResponseCode() + ': ' + txt.slice(0, 300) }; }
  if (d.responseCode !== 200 && d.responseCode !== 201) {
    return { ok: false, detalle: '(' + d.responseCode + ') ' + (d.message || txt.slice(0, 300)) };
  }
  return { ok: true, id: d.content && (d.content.submissionID || d.content.submission_id) };
}

/** Id de la submission más reciente, para cuando el endpoint público no lo devuelve. */
function ultimoEnvio() {
  try {
    var r = UrlFetchApp.fetch(API + '/form/' + CONFIG.FORM_ID + '/submissions?apiKey=' + llave() +
      '&limit=1', { muteHttpExceptions: true });
    var d = JSON.parse(r.getContentText());
    return d.content && d.content[0] ? d.content[0].id : '';
  } catch (e) { return ''; }
}

function serializar(payload, qid, q, a) {
  var base = nombreCampo(qid, q);
  var sub = function (etiqueta) {
    return CONFIG.MODO_ENVIO === 'formulario'
      ? base + '[' + etiqueta + ']'
      : 'submission[' + qid + '][' + etiqueta + ']';
  };
  var idx = function (i) {
    return CONFIG.MODO_ENVIO === 'formulario'
      ? base + '[' + i + ']'
      : 'submission[' + qid + '][' + i + ']';
  };
  var tipo = a.tipo, v = a.valor;

  if (q.type === 'control_phone') { payload[sub('full')] = String(v); return; }

  if (tipo === 'checks') {
    // La app solo usa 'checks' en grupos de casillas, así que siempre se manda
    // con la llave repetida. No se consulta q.type: la API no siempre reporta
    // control_checkbox y unir con comas hacía que Jotform descartara el valor.
    var arr = [].concat(v);
    if (CONFIG.MODO_ENVIO === 'formulario') {
      payload[base + '[]'] = arr;
    } else {
      for (var i = 0; i < arr.length; i++) payload[idx(i)] = arr[i];
    }
    return;
  }

  if (tipo === 'datetime') {
    var partes = String(v.fecha || '').split('-');           // YYYY-MM-DD
    if (partes.length !== 3) return;
    payload[sub('year')] = partes[0];
    payload[sub('month')] = partes[1];
    payload[sub('day')] = partes[2];
    if (v.hora) {
      var hm = String(v.hora).split(':');
      var h = parseInt(hm[0], 10), m = hm[1] || '00';
      var doceHoras = /AM|PM|12/i.test(String(q.timeFormat || ''));   // este formulario usa 24 h
      if (doceHoras) {
        var h12 = h % 12; if (h12 === 0) h12 = 12;
        payload[sub('hour')] = String(h12);
        payload[sub('min')] = m;
        payload[sub('ampm')] = h >= 12 ? 'PM' : 'AM';
      } else {
        payload[sub('hour')] = String(h);
        payload[sub('min')] = m;
        payload[sub('timeInput')] = String(h) + ':' + m;
      }
    }
    return;
  }

  if (tipo === 'tabla') {
    serializarTabla(payload, qid, q, [].concat(v));
    return;
  }

  payload[base] = String(v);       // texto, selección simple y firma en base64
}

/** Nombre del campo tal como lo espera cada endpoint. */
function nombreCampo(qid, q) {
  return CONFIG.MODO_ENVIO === 'formulario'
    ? 'q' + qid + '_' + q.name
    : 'submission[' + qid + ']';
}

/**
 * Valores de Medición. Columnas: Medicion | Valor Programado | Valor Desplegado | Valor Medido.
 * Si el campo es una tabla de entrada se llena celda por celda; si es texto, en renglones.
 */
function serializarTabla(payload, qid, q, filas) {
  var COLS = ['m', 'prog', 'desp', 'med'];
  var TITULOS = columnasMatriz(q);
  var base = nombreCampo(qid, q);

  // Tabla de entrada nativa: se llena celda por celda.
  if (q.type === 'control_matrix') {
    for (var f = 0; f < filas.length; f++) {
      for (var c = 0; c < COLS.length; c++) {
        var val = filas[f][COLS[c]];
        if (val !== '' && val != null) {
          payload[CONFIG.MODO_ENVIO === 'formulario'
            ? base + '[' + f + '][' + c + ']'
            : 'submission[' + qid + '][' + f + '][' + c + ']'] = String(val);
        }
      }
    }
    return;
  }

  // Widget Matrix Dinámica: un solo campo con la tabla empaquetada.
  var matriz = filas.map(function (r) {
    return COLS.map(function (k) { return r[k] == null ? '' : String(r[k]); });
  });

  if (q.type === 'control_widget' && CONFIG.FORMATO_MATRIZ === 'objetos') {
    payload[base] = JSON.stringify(matriz.map(function (fila) {
      var o = {};
      for (var i = 0; i < TITULOS.length; i++) o[TITULOS[i]] = fila[i] || '';
      return o;
    }));
    return;
  }
  if (q.type === 'control_widget' && CONFIG.FORMATO_MATRIZ === 'json') {
    payload[base] = JSON.stringify(matriz);
    return;
  }

  var lineas = [TITULOS.join(' | ')];
  for (var i = 0; i < matriz.length; i++) lineas.push(matriz[i].join(' | '));
  payload[base] = lineas.join('\n');
}

/** Lee los encabezados configurados en el widget: "Medicion:125,Valor Programado:125,..." */
function columnasMatriz(q) {
  var crudo = String(q.cols || '');
  if (!crudo) return ['Medicion', 'Valor Programado', 'Valor Desplegado', 'Valor Medido'];
  return crudo.split(',').map(function (c) { return c.split(':')[0].trim(); });
}

function obtenerCarpeta() {
  if (CONFIG.DRIVE_FOLDER_ID) return DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  var it = DriveApp.getFoldersByName('Evidencia OT');
  return it.hasNext() ? it.next() : DriveApp.createFolder('Evidencia OT');
}

function bitacora(subID, body, enlaces) {
  if (!CONFIG.SHEET_ID) return;
  try {
    var libro = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var hoja = libro.getSheetByName('Bitacora OT') || libro.insertSheet('Bitacora OT');
    if (hoja.getLastRow() === 0) hoja.appendRow(['Fecha', 'SubmissionID', 'ID local', 'Fotos', 'Respuestas']);
    hoja.appendRow([new Date(), subID, body.cliente || '', enlaces.join(' '), JSON.stringify(body.answers).slice(0, 40000)]);
  } catch (e) {}
}

/* ============================ SESIÓN DEL COORDINADOR ============================ */

function hashPin(pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin) + CONFIG.SAL_PIN);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] < 0 ? bytes[i] + 256 : bytes[i]).toString(16);
    hex += (b.length === 1 ? '0' : '') + b;
  }
  return hex;
}

/** Ejecutar una vez con el PIN deseado y pegar el resultado en CONFIG.PIN_COORDINADOR. */
function generarHashPin() {
  var PIN = '1234';                       // cambiar por el PIN real antes de ejecutar
  Logger.log('PIN_COORDINADOR: ' + hashPin(PIN));
  Logger.log('Pegue ese valor en CONFIG y borre el PIN de esta función.');
}

function iniciarSesion(pin) {
  if (!pin || String(pin).length !== 4) return { ok: false, error: 'El PIN son 4 dígitos' };
  if (hashPin(pin) !== CONFIG.PIN_COORDINADOR) return { ok: false, error: 'PIN incorrecto' };
  var token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('ses_' + token,
    JSON.stringify({ perfil: 'coordinador', vence: Date.now() + 12 * 3600 * 1000 }));
  return { ok: true, sesion: token, perfil: 'coordinador', nombre: CONFIG.COORDINADOR };
}

function esCoordinador(token) {
  if (!token) return false;
  var props = PropertiesService.getScriptProperties();
  var crudo = props.getProperty('ses_' + token);
  if (!crudo) return false;
  try {
    var s = JSON.parse(crudo);
    if (s.vence < Date.now()) { props.deleteProperty('ses_' + token); return false; }
    return s.perfil === 'coordinador';
  } catch (e) { return false; }
}

/* ============================ CHAT ============================ */

/**
 * Conversaciones por orden de trabajo o por equipo.
 * Hoja: Fecha | Clave | Titulo | Ingeniero | Autor | Mensaje
 *   Clave identifica el hilo (folio IAB-xxxxx o número de inventario).
 *   Ingeniero es a quién pertenece el hilo; el coordinador los ve todos.
 */
function hojaChat() {
  var libro = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var hoja = libro.getSheetByName(CONFIG.CHAT_TAB);
  if (!hoja) {
    hoja = libro.insertSheet(CONFIG.CHAT_TAB);
    hoja.appendRow(['Fecha', 'Clave', 'Titulo', 'Ingeniero', 'Autor', 'Mensaje']);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, 6).setFontWeight('bold');
    hoja.setColumnWidth(6, 520);
  }
  return hoja;
}

function filasChat() {
  var hoja = hojaChat();
  if (hoja.getLastRow() < 2) return [];
  var datos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 6).getValues();
  var salida = [];
  for (var i = 0; i < datos.length; i++) {
    var f = datos[i];
    if (!String(f[1] || '').trim()) continue;
    salida.push({
      ts: (f[0] instanceof Date) ? f[0].getTime() : new Date(f[0]).getTime() || 0,
      fecha: aIso(f[0]),
      clave: String(f[1]).trim(),
      titulo: String(f[2] || ''),
      ingeniero: String(f[3] || ''),
      autor: String(f[4] || ''),
      mensaje: String(f[5] || '')
    });
  }
  return salida;
}

function chatHilos(ingeniero, sesion) {
  var cache = CacheService.getScriptCache();
  var coord = esCoordinador(sesion);
  var clave = 'hilos_' + (coord ? 'coord' : normalizar(ingeniero).replace(/[^A-Z0-9]/g, '').slice(0, 40));
  var guardado = cache.get(clave);
  if (guardado) { try { return JSON.parse(guardado); } catch (e) {} }

  var filas = filasChat();
  var mapa = {};
  for (var i = 0; i < filas.length; i++) {
    var m = filas[i];
    if (!coord && ingeniero && m.ingeniero && normalizar(m.ingeniero) !== normalizar(ingeniero)) continue;
    var h = mapa[m.clave];
    if (!h) { h = mapa[m.clave] = { clave: m.clave, titulo: m.titulo, ingeniero: m.ingeniero, mensajes: 0 }; }
    h.mensajes++;
    if (m.titulo) h.titulo = m.titulo;
    if (m.ingeniero) h.ingeniero = m.ingeniero;
    if (!h.ultimoTs || m.ts >= h.ultimoTs) {
      h.ultimoTs = m.ts; h.ultimaFecha = m.fecha;
      h.ultimo = m.mensaje.slice(0, 90); h.ultimoAutor = m.autor;
    }
  }
  var lista = [];
  for (var k in mapa) lista.push(mapa[k]);
  lista.sort(function (a, b) { return (b.ultimoTs || 0) - (a.ultimoTs || 0); });
  try { cache.put(clave, JSON.stringify(lista), 15); } catch (e) {}
  return lista;
}

function chatMensajes(clave, desde) {
  if (!clave) return [];
  var cache = CacheService.getScriptCache();
  var llave = 'msj_' + String(clave).replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  var todos = null;
  var guardado = cache.get(llave);
  if (guardado) { try { todos = JSON.parse(guardado); } catch (e) {} }
  if (!todos) {
    todos = [];
    var filas = filasChat();
    for (var i = 0; i < filas.length; i++) {
      if (normalizar(filas[i].clave) === normalizar(clave)) todos.push(filas[i]);
    }
    try { cache.put(llave, JSON.stringify(todos), 10); } catch (e) {}
  }
  if (!desde) return todos;
  var nuevos = [];
  for (var j = 0; j < todos.length; j++) if (todos[j].ts > desde) nuevos.push(todos[j]);
  return nuevos;
}

function chatEnviar(body) {
  var texto = String(body.mensaje || '').trim();
  if (!texto) throw new Error('El mensaje está vacío');
  if (!body.clave) throw new Error('Falta identificar la conversación');

  var coord = esCoordinador(body.sesion);
  var autor = coord ? CONFIG.COORDINADOR : String(body.autor || '').trim();
  if (!autor) throw new Error('No se identificó al autor');

  // Varios ingenieros pueden escribir a la vez: sin candado se pisan las filas.
  var candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    hojaChat().appendRow([new Date(), String(body.clave).trim(), String(body.titulo || ''),
      String(body.ingeniero || ''), autor, texto.slice(0, 4000)]);
  } finally { candado.releaseLock(); }

  var cache = CacheService.getScriptCache();
  cache.remove('msj_' + String(body.clave).replace(/[^A-Za-z0-9]/g, '').slice(0, 40));
  cache.remove('hilos_coord');
  if (body.ingeniero) cache.remove('hilos_' + normalizar(body.ingeniero).replace(/[^A-Z0-9]/g, '').slice(0, 40));
  return { ok: true, autor: autor };
}

/* ============================ AVISOS ============================ */

/**
 * Avisos para los ingenieros, capturados a mano en la hoja.
 * Columnas: Fecha | Ingeniero | Tipo | Titulo | Mensaje | Activo
 *   Ingeniero: nombre exacto, o vacío / "TODOS" para que lo vean todos.
 *   Tipo: informativo | mantenimiento | urgente  (define el color en la app)
 *   Activo: NO lo oculta; cualquier otra cosa lo muestra.
 */
function hojaAvisos() {
  var libro = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var hoja = libro.getSheetByName(CONFIG.AVISOS_TAB);
  if (!hoja) {
    hoja = libro.insertSheet(CONFIG.AVISOS_TAB);
    hoja.appendRow(['Fecha', 'Ingeniero', 'Tipo', 'Titulo', 'Mensaje', 'Activo']);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, 6).setFontWeight('bold');
    hoja.setColumnWidth(5, 500);
  }
  return hoja;
}

function colsAvisos(enc) {
  function buscar(nombres) {
    for (var n = 0; n < nombres.length; n++) {
      for (var c = 0; c < enc.length; c++) {
        if (normalizar(enc[c]) === normalizar(nombres[n])) return c;
      }
    }
    return -1;
  }
  return {
    fecha: buscar(['Fecha']), ingeniero: buscar(['Ingeniero']), tipo: buscar(['Tipo']),
    titulo: buscar(['Titulo', 'Título']), mensaje: buscar(['Mensaje']), activo: buscar(['Activo'])
  };
}

/**
 * Avisos para los ingenieros. La coordinación los ve todos, incluidos los ocultos,
 * y recibe el número de fila para poder editarlos desde la app.
 */
function listarAvisos(ingeniero, sesion) {
  var hoja;
  try { hoja = hojaAvisos(); } catch (e) { return []; }
  if (!hoja || hoja.getLastRow() < 2) return [];

  var coord = esCoordinador(sesion);
  var datos = hoja.getDataRange().getValues();
  var c = colsAvisos(datos[0]);

  var salida = [];
  for (var f = 1; f < datos.length; f++) {
    var fila = datos[f];
    if (!fila.join('').trim()) continue;
    var activo = c.activo < 0 || normalizar(fila[c.activo]) !== 'NO';
    if (!coord && !activo) continue;

    var destino = c.ingeniero >= 0 ? String(fila[c.ingeniero] || '').trim() : '';
    var paraTodos = !destino || normalizar(destino) === 'TODOS';
    if (!coord && !paraTodos && ingeniero && normalizar(destino) !== normalizar(ingeniero)) continue;

    salida.push({
      id: 'a' + f,
      fila: f + 1,
      fecha: c.fecha >= 0 ? aIso(fila[c.fecha]) : '',
      destinatario: destino || 'TODOS',
      tipo: c.tipo >= 0 ? String(fila[c.tipo] || 'informativo').toLowerCase().trim() : 'informativo',
      titulo: c.titulo >= 0 ? String(fila[c.titulo] || '') : '',
      mensaje: c.mensaje >= 0 ? String(fila[c.mensaje] || '') : '',
      activo: activo,
      paraTodos: paraTodos
    });
  }
  salida.sort(function (a, b) { return (b.fecha || '').localeCompare(a.fecha || ''); });
  return salida;
}

/** Publica, edita u oculta un aviso. Solo con sesión de coordinación. */
function guardarAviso(body) {
  if (!esCoordinador(body.sesion)) throw new Error('Solo la coordinación puede publicar avisos');

  var hoja = hojaAvisos();
  var enc = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  var c = colsAvisos(enc);
  var ancho = Math.max(6, enc.length);

  var valores = [];
  for (var i = 0; i < ancho; i++) valores.push('');
  function poner(indice, valor) { if (indice >= 0) valores[indice] = valor; }

  var candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    if (body.fila) {                                  // edición: conservar la fecha original
      var actual = hoja.getRange(Number(body.fila), 1, 1, ancho).getValues()[0];
      for (var j = 0; j < ancho; j++) valores[j] = actual[j];
    } else {
      poner(c.fecha, new Date());
    }
    if (body.titulo !== undefined) poner(c.titulo, String(body.titulo).slice(0, 200));
    if (body.mensaje !== undefined) poner(c.mensaje, String(body.mensaje).slice(0, 4000));
    if (body.tipo !== undefined) poner(c.tipo, String(body.tipo || 'informativo'));
    if (body.destinatario !== undefined) poner(c.ingeniero, String(body.destinatario || 'TODOS'));
    if (body.activo !== undefined) poner(c.activo, body.activo ? 'SI' : 'NO');
    else if (!body.fila) poner(c.activo, 'SI');

    if (body.fila) hoja.getRange(Number(body.fila), 1, 1, ancho).setValues([valores]);
    else hoja.appendRow(valores);
  } finally { candado.releaseLock(); }

  return { ok: true };
}

/** Crea la pestaña de avisos con sus encabezados y un ejemplo. Ejecutar una vez. */
function prepararAvisos() {
  var hoja = hojaAvisos();
  if (hoja.getLastRow() < 2) {
    hoja.appendRow([new Date(), 'TODOS', 'informativo', 'Bienvenidos a la app',
      'Aquí van a aparecer los mantenimientos asignados y los avisos del área.', 'SI']);
  }
  Logger.log('Pestaña "' + CONFIG.AVISOS_TAB + '" lista en la hoja ' + CONFIG.SHEET_ID);
  Logger.log('Ingeniero: nombre exacto, o TODOS. Tipo: informativo, mantenimiento o urgente. Activo: NO para ocultar.');
}

/* ============================ CONSULTA ============================ */

/**
 * "Mis envíos" se lee de la hoja que alimenta Jotform, no de la API:
 * ahí está el histórico completo y se resuelve en una sola lectura.
 * Devuelve una lista ligera; el detalle de cada orden se pide aparte.
 */
function listarEnvios(ingeniero, limite) {
  var cache = CacheService.getScriptCache();
  var clave = 'envios2_' + normalizar(ingeniero || 'todos').replace(/[^A-Z0-9]/g, '').slice(0, 60);
  var guardado = cache.get(clave);
  if (guardado) { try { return JSON.parse(guardado); } catch (e) {} }

  var datos = datosHojaEnvios();
  var col = columnasEnvios(datos);
  var tope = limite || 500;
  var salida = [];

  // De abajo hacia arriba: la hoja crece por el final, así que ahí están los recientes.
  for (var i = datos.length - 1; i >= 1 && salida.length < tope; i--) {
    var fila = datos[i];
    if (!fila || !fila.join('').trim()) continue;
    var nombre = col.ingeniero >= 0 ? String(fila[col.ingeniero] || '') : '';
    if (ingeniero && normalizar(nombre) !== normalizar(ingeniero)) continue;

    salida.push({
      fila: i + 1,
      id: col.id >= 0 ? String(fila[col.id] || '') : String(i + 1),
      created_at: aIso(col.fecha >= 0 ? fila[col.fecha] : ''),
      folio: col.folio >= 0 ? String(fila[col.folio] || '') : '',
      equipo: col.equipo >= 0 ? String(fila[col.equipo] || '') : '',
      unidad: col.unidad >= 0 ? String(fila[col.unidad] || '') : '',
      inventario: col.inventario >= 0 ? String(fila[col.inventario] || '') : ''
    });
  }
  try { cache.put(clave, JSON.stringify(salida), 180); } catch (e) {}
  return salida;
}

/** Todas las columnas de una orden, para la vista de detalle. */
function detalleEnvio(numeroFila) {
  var datos = datosHojaEnvios();
  var n = Number(numeroFila) - 1;
  if (!(n > 0 && n < datos.length)) throw new Error('Esa orden ya no está en la hoja');
  var enc = datos[0], fila = datos[n];
  var respuestas = [];
  for (var c = 0; c < enc.length; c++) {
    var etiqueta = String(enc[c] || '').trim();
    var valor = fila[c];
    if (!etiqueta || valor === '' || valor === null || valor === undefined) continue;
    var texto = (valor instanceof Date) ? aIso(valor) : String(valor);
    if (texto.indexOf('data:image') === 0) texto = '[firma capturada]';
    respuestas.push({ pregunta: etiqueta, valor: texto.slice(0, 700) });
  }
  return respuestas;
}

function datosHojaEnvios() {
  var libro = SpreadsheetApp.openById(CONFIG.ENVIOS_SHEET_ID);
  var hoja = libro.getSheetByName(CONFIG.ENVIOS_TAB);
  if (!hoja) throw new Error('No existe la pestaña "' + CONFIG.ENVIOS_TAB + '" en la hoja de envíos');
  var datos = hoja.getDataRange().getValues();
  if (datos.length < 2) throw new Error('La hoja de envíos está vacía');
  return datos;
}

/**
 * Localiza las columnas por el texto del encabezado. Cuando varias columnas
 * comparten nombre (el formulario repite "INGENIERO DE SERVICIO" como título
 * y como campo), gana la que trae datos.
 */
function columnasEnvios(datos) {
  var enc = datos[0];
  var muestra = datos.slice(1, 80);

  function elegir(etiquetas) {
    var mejor = -1, mejorPuntaje = -1;
    for (var c = 0; c < enc.length; c++) {
      var h = normalizar(enc[c]);
      if (!h) continue;
      var puntaje = -1;
      for (var e = 0; e < etiquetas.length; e++) {
        var objetivo = normalizar(etiquetas[e]);
        if (h === objetivo) puntaje = Math.max(puntaje, 100 - e * 10);
        else if (h.indexOf(objetivo) === 0) puntaje = Math.max(puntaje, 60 - e * 10);
      }
      if (puntaje < 0) continue;
      var llenas = 0;
      for (var f = 0; f < muestra.length; f++) {
        if (muestra[f][c] !== '' && muestra[f][c] !== null) llenas++;
      }
      puntaje += Math.round((llenas / Math.max(1, muestra.length)) * 40);
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = c; }
    }
    return mejor;
  }

  return {
    fecha: elegir(['Submission Date', 'Fecha de envío', 'Fecha de Inicio:', 'Submission ID']),
    id: elegir(['Submission ID']),
    folio: elegir(['ID único', 'ID unico']),
    ingeniero: elegir(['INGENIERO DE SERVICIO:', 'INGENIERO DE SERVICIO']),
    unidad: elegir(['UNIDAD:', 'UNIDAD']),
    equipo: elegir(['EQUIPO:', 'EQUIPO']),
    inventario: elegir(['INVENTARIO:', 'INVENTARIO'])
  };
}

/** Fecha en formato ISO con T, que es el que interpretan todos los navegadores. */
function aIso(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  var t = String(v || '').trim();
  if (!t) return '';
  var d = new Date(t.replace(' ', 'T'));
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  return t;
}

function aTexto(a) {
  if (a == null) return '';
  if (typeof a === 'string') return a;
  if (Object.prototype.toString.call(a) === '[object Array]') return a.join(', ');
  if (typeof a === 'object') {
    if (a.year) {
      var f = [a.year, a.month, a.day].filter(String).join('-');
      var h = [a.hour, a.min].filter(String).join(':');
      return (f + ' ' + h + ' ' + (a.ampm || '')).trim();
    }
    var partes = [];
    for (var k in a) if (a[k]) partes.push(a[k]);
    return partes.join(' ');
  }
  return String(a);
}

/* ============================ PRUEBAS ============================ */

/**
 * Prueba la aplicación web tal como la ve un celular (sin sesión de Google).
 * Pegue abajo la URL /exec y el TOKEN antes de ejecutar.
 */
function probarWebApp() {
  var URL_EXEC = 'https://script.google.com/macros/s/AKfycbw2nV9hEZvzPSIDlCPyHOgjB3JaAK2jkAAQ4aQHFciCUFrcXzPVtgNwPUKrNm9BKMQb/exec';
  var TOKEN = CONFIG.TOKEN;

  ['ping', 'schema'].forEach(function (accion) {
    var u = URL_EXEC + '?action=' + accion + '&token=' + encodeURIComponent(TOKEN);
    var r = UrlFetchApp.fetch(u, { muteHttpExceptions: true, followRedirects: true });
    var txt = r.getContentText();
    Logger.log('--- ' + accion + ' -> HTTP ' + r.getResponseCode() + ' (' + txt.length + ' caracteres)');
    if (txt.indexOf('<!DOCTYPE') === 0 || txt.indexOf('<html') > -1) {
      Logger.log('  DEVOLVIÓ UNA PÁGINA HTML: la implementación pide iniciar sesión.');
      Logger.log('  Corrija en Implementar > Administrar implementaciones > Editar > Quién tiene acceso: Cualquier usuario.');
    } else {
      Logger.log('  ' + txt.slice(0, 400));
    }
  });
}

/** Diagnóstico rápido: estado de la llave y respuesta literal de Jotform. */
function diagnostico() {
  var k = String(CONFIG.API_KEY);
  Logger.log('Longitud de la API Key: ' + k.length + ' (lo normal son 32)');
  Logger.log('¿Trae espacios o tabuladores?: ' + /\s/.test(k));
  Logger.log('Formulario: ' + CONFIG.FORM_ID);
  var r = UrlFetchApp.fetch(API + '/form/' + CONFIG.FORM_ID + '/questions?apiKey=' + llave(),
    { muteHttpExceptions: true });
  Logger.log('HTTP ' + r.getResponseCode());
  Logger.log(r.getContentText().slice(0, 800));
}

/**
 * Envía una orden mínima de prueba por el endpoint público, sin archivos.
 * Sirve para aislar si el rechazo viene del cuerpo multipart o del endpoint.
 * OJO: crea un envío real y puede disparar los correos del flujo.
 */
function probarEnvioMinimo() {
  var p = obtenerPreguntas(true);
  var payload = {};
  var textos = { '10': 'PRUEBA', '11': 'PRUEBA', '39': 'PRUEBA TECNICA', '57': 'PRUEBA TECNICA' };
  for (var qid in textos) {
    if (p[qid]) payload['q' + qid + '_' + p[qid].name] = textos[qid];
  }
  if (p['127']) payload['q127_' + p['127'].name] = 'Erick Geovanni Serrano Espíndola';
  if (p['77']) payload['q77_' + p['77'].name + '[]'] = ['GARANTÍA'];

  var res = postFormulario(payload);
  Logger.log(DIARIO.join('\n'));
  Logger.log('RESULTADO: ' + JSON.stringify(res));
  DIARIO = [];
}

/** Averigua cuál de las rutas de envío acepta este formulario, sin mandar datos reales. */
function probarRutasEnvio() {
  var rutas = [
    'https://submit.jotform.com/submit/' + CONFIG.FORM_ID,
    'https://submit.jotform.com/submit/' + CONFIG.FORM_ID + '/',
    'https://www.jotform.com/submit/' + CONFIG.FORM_ID,
    'https://form.jotform.com/submit/' + CONFIG.FORM_ID
  ];
  rutas.forEach(function (u) {
    try {
      var r = UrlFetchApp.fetch(u, { method: 'post', payload: { formID: CONFIG.FORM_ID },
        muteHttpExceptions: true, followRedirects: false });
      Logger.log(u + ' → HTTP ' + r.getResponseCode());
    } catch (e) { Logger.log(u + ' → error: ' + e.message); }
  });
  Logger.log('La ruta buena responde 200 o 302. Las que dan 404 no aplican a este formulario.');
}

/**
 * Busca en los envíos existentes el valor crudo del campo Valores de Medición.
 * Sirve para copiar el formato exacto que guarda el widget Matrix Dinámica.
 */
function verFormatoMediciones() {
  var p = obtenerPreguntas(true);
  var qid = buscarQid(p, 'Valores de Medición');
  Logger.log('Columnas configuradas: ' + columnasMatriz(p[qid]).join(' | '));

  var r = UrlFetchApp.fetch(API + '/form/' + CONFIG.FORM_ID + '/submissions?apiKey=' + llave() +
    '&limit=100', { muteHttpExceptions: true });
  var d = JSON.parse(r.getContentText());
  var encontrados = 0;

  for (var i = 0; i < d.content.length; i++) {
    var a = d.content[i].answers || {};
    if (!a[qid] || !a[qid].answer) continue;
    encontrados++;
    Logger.log('--- envío ' + d.content[i].id + ' (' + d.content[i].created_at + ')');
    Logger.log('tipo del dato: ' + (typeof a[qid].answer));
    Logger.log('valor crudo: ' + JSON.stringify(a[qid].answer));
    if (encontrados >= 3) break;
  }
  if (!encontrados) {
    Logger.log('Ningún envío tiene ese campo lleno.');
    Logger.log('Llene el formulario público a mano con dos renglones de medición,');
    Logger.log('envíelo, y vuelva a ejecutar esta función.');
  }
}

/**
 * Compara cómo quedaron guardados los campos conflictivos en los últimos envíos.
 * Sirve para ver qué llegó realmente de la app frente a un envío hecho a mano.
 */
function verRespuestasCrudas() {
  var qids = ['62', '63', '77', '127', '147', '20'];
  var r = UrlFetchApp.fetch(API + '/form/' + CONFIG.FORM_ID + '/submissions?apiKey=' + llave() +
    '&limit=4', { muteHttpExceptions: true });
  var d = JSON.parse(r.getContentText());
  for (var i = 0; i < d.content.length; i++) {
    var s = d.content[i], a = s.answers || {};
    Logger.log('===== envío ' + s.id + '  (' + s.created_at + ')');
    for (var j = 0; j < qids.length; j++) {
      var q = a[qids[j]];
      Logger.log('  qid ' + qids[j] + ' [' + (q ? q.text || q.name : 'sin respuesta') + '] = ' +
        (q ? JSON.stringify(q.answer) : '—'));
    }
  }
}

/**
 * Envío de prueba CON una foto generada al vuelo, para aislar el adjunto.
 * OJO: crea un envío real y dispara los correos del flujo.
 */
function probarEnvioConFoto() {
  var p = obtenerPreguntas(true);
  var payload = {};

  // Todos los campos obligatorios con valores de prueba
  var textos = { '10': 'PRUEBA', '11': 'PRUEBA', '12': 'PRUEBA', '13': 'PRUEBA',
    '14': 'PRUEBA', '15': 'PRUEBA', '16': 'PRUEBA', '19': 'PRUEBA', '39': 'PRUEBA TECNICA' };
  for (var qid in textos) if (p[qid]) payload['q' + qid + '_' + p[qid].name] = textos[qid];
  if (p['64']) payload['q64_' + p['64'].name + '[full]'] = '5555555555';
  if (p['65']) payload['q65_' + p['65'].name] = 'prueba@ejemplo.com';
  if (p['66']) payload['q66_' + p['66'].name] = 'Ciudad de México';
  if (p['73']) payload['q73_' + p['73'].name] = '2026';
  if (p['127']) payload['q127_' + p['127'].name] = 'Erick Geovanni Serrano Espíndola';
  ['62', '63'].forEach(function (q) {
    if (!p[q]) return;
    var b = 'q' + q + '_' + p[q].name;
    var hoy = new Date();
    payload[b + '[year]'] = String(hoy.getFullYear());
    payload[b + '[month]'] = ('0' + (hoy.getMonth() + 1)).slice(-2);
    payload[b + '[day]'] = ('0' + hoy.getDate()).slice(-2);
    payload[b + '[hour]'] = String(hoy.getHours());
    payload[b + '[min]'] = ('0' + hoy.getMinutes()).slice(-2);
    payload[b + '[timeInput]'] = hoy.getHours() + ':' + ('0' + hoy.getMinutes()).slice(-2);
  });

  // Imagen mínima real (PNG de 1x1) como adjunto
  var png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  var blob = Utilities.newBlob(Utilities.base64Decode(png), 'image/jpeg', 'prueba.jpg');
  if (p['147']) payload['q147_' + p['147'].name + '[]'] = [blob];

  // Casillas y firmas obligatorias: se llenan leyendo el propio esquema,
  // así la prueba sigue sirviendo aunque cambien los campos del formulario.
  for (var q2 in p) {
    var pregunta = p[q2];
    if (String(pregunta.required) !== 'Yes') continue;
    var clave = 'q' + q2 + '_' + pregunta.name;
    if (payload[clave] || payload[clave + '[]']) continue;
    // Fecha y teléfono viajan en subcampos: si ya hay alguno, el campo está cubierto.
    var cubierto = false;
    for (var kk in payload) { if (kk.indexOf(clave + '[') === 0) { cubierto = true; break; } }
    if (cubierto) continue;
    if (pregunta.type === 'control_checkbox') {
      var ops = String(pregunta.options || '').split('|');
      if (ops[0]) payload[clave + '[]'] = [ops[0]];
    } else if (pregunta.type === 'control_signature') {
      payload[clave] = 'data:image/png;base64,' + png;
    } else if (pregunta.type === 'control_widget' || pregunta.type === 'control_fileupload') {
      continue;
    } else if (!payload[clave]) {
      payload[clave] = 'PRUEBA';
    }
  }

  camposAutomaticos(payload, p);
  var faltan = obligatoriosFaltantes(payload, p);
  if (faltan.length) { Logger.log('Faltan obligatorios: ' + faltan.join(', ')); return; }

  var res = postFormulario(payload);
  Logger.log(DIARIO.join('\n'));
  Logger.log('RESULTADO: ' + JSON.stringify(res));
  DIARIO = [];
}

/** Lista los campos que Jotform marca como obligatorios, con su tipo. */
function verObligatorios() {
  var p = obtenerPreguntas(false);
  var lista = [];
  for (var qid in p) {
    if (String(p[qid].required) !== 'Yes') continue;
    lista.push([Number(p[qid].order), 'qid ' + qid + ' · ' + p[qid].type.replace('control_', '') +
      ' · ' + (p[qid].text || p[qid].name)]);
  }
  lista.sort(function (a, b) { return a[0] - b[0]; });
  Logger.log('Campos obligatorios: ' + lista.length);
  for (var i = 0; i < lista.length; i++) Logger.log('  ' + lista[i][1]);
}

/** Revisa que la hoja de envíos se lea bien y qué columnas se están usando. */
function verHojaEnvios() {
  var datos = datosHojaEnvios();
  var col = columnasEnvios(datos);
  Logger.log('Filas (con encabezado): ' + datos.length + ' · Columnas: ' + datos[0].length);
  for (var k in col) {
    Logger.log('  ' + k + ' → columna ' + (col[k] + 1) + ' [' + (col[k] >= 0 ? datos[0][col[k]] : 'NO ENCONTRADA') + ']');
  }
  var ultima = datos[datos.length - 1];
  Logger.log('Última fila: fecha=' + aIso(col.fecha >= 0 ? ultima[col.fecha] : '') +
    ' · ingeniero=' + (col.ingeniero >= 0 ? ultima[col.ingeniero] : '') +
    ' · unidad=' + (col.unidad >= 0 ? ultima[col.unidad] : '') +
    ' · folio=' + (col.folio >= 0 ? ultima[col.folio] : ''));
}

/** Muestra la definición completa del campo Valores de Medición. */
function verCampoMediciones() {
  var p = obtenerPreguntas(false);
  var qid = buscarQid(p, 'Valores de Medición');
  if (!qid) { Logger.log('No se encontró el campo.'); return; }
  Logger.log('qid ' + qid + ' · tipo ' + p[qid].type + ' · name ' + p[qid].name);
  Logger.log(JSON.stringify(p[qid], null, 2));
}

/** Ejecutar desde el editor para verificar la API Key y ver los qid del formulario. */
function probarConexion() {
  var p = obtenerPreguntas(false);
  var lista = [];
  for (var k in p) lista.push([p[k].order, k, p[k].type, p[k].text].join(' | '));
  lista.sort(function (a, b) { return Number(a.split(' | ')[0]) - Number(b.split(' | ')[0]); });
  Logger.log('Preguntas encontradas: ' + lista.length + '\n' + lista.join('\n'));
}