
const { useState, useEffect, useRef, useCallback, useMemo } = React;

/* ==========================================================
   1. ALMACENAMIENTO LOCAL  (IndexedDB → localStorage → RAM)
   ========================================================== */
const Store = (() => {
  const DB = "ot_ia_v2", STORES = ["drafts", "outbox", "sent", "meta", "chatCola"];
  let db = null, modo = "memoria";
  const mem = { drafts: {}, outbox: {}, sent: {}, meta: {}, chatCola: {} };

  function abrir() {
    return new Promise(res => {
      if (!("indexedDB" in window)) return res(null);
      let req;
      try { req = indexedDB.open(DB, 2); } catch (e) { return res(null); }
      req.onupgradeneeded = () => STORES.forEach(s => {
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: "id" });
      });
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
      // 2.5 s era poco para la primera apertura en un teléfono lento: caía a
      // localStorage y los borradores quedaban en un almacén distinto al de la
      // siguiente apertura.
      setTimeout(() => res(null), 6000);
    });
  }
  let aceptaBlob = false;
  async function probarBlob() {
    // Algunos Safari viejos aceptan IndexedDB pero no guardan Blob: se prueba una vez
    try {
      await new Promise((res, rej) => {
        const t = db.transaction("meta", "readwrite"), st = t.objectStore("meta");
        st.put({ id: "__blob", b: new Blob(["ok"], { type: "text/plain" }) });
        st.delete("__blob");
        t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
      aceptaBlob = typeof Blob !== "undefined";
    } catch (e) { aceptaBlob = false; }
  }
  async function init() {
    db = await abrir();
    if (db) { modo = "indexeddb"; await probarBlob(); return modo; }
    try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); modo = "localstorage"; }
    catch (e) { modo = "memoria"; }
    return modo;
  }
  const lsKey = (s, id) => `${DB}:${s}:${id}`;
  function lsAll(s) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${DB}:${s}:`)) { try { out.push(JSON.parse(localStorage.getItem(k))); } catch (e) {} }
    }
    return out;
  }
  function tx(s, m) { return db.transaction(s, m).objectStore(s); }

  return {
    init, get modo() { return modo; }, get aceptaBlob() { return aceptaBlob; },
    async put(s, obj) {
      if (modo === "indexeddb") return new Promise((res, rej) => { const r = tx(s, "readwrite").put(obj); r.onsuccess = () => res(obj); r.onerror = () => rej(r.error); });
      if (modo === "localstorage") { localStorage.setItem(lsKey(s, obj.id), JSON.stringify(obj)); return obj; }
      mem[s][obj.id] = obj; return obj;
    },
    async del(s, id) {
      if (modo === "indexeddb") return new Promise(res => { const r = tx(s, "readwrite").delete(id); r.onsuccess = () => res(); r.onerror = () => res(); });
      if (modo === "localstorage") { localStorage.removeItem(lsKey(s, id)); return; }
      delete mem[s][id];
    },
    async all(s) {
      if (modo === "indexeddb") return new Promise(res => { const r = tx(s, "readonly").getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
      if (modo === "localstorage") return lsAll(s);
      return Object.values(mem[s]);
    },
    // Lectura directa por clave: antes se leía TODA la tienda (esquema, historial de
    // envíos, avisos…) para quedarse con un solo registro, unas diez veces al abrir.
    async one(s, id) {
      if (modo === "indexeddb") return new Promise(res => { const r = tx(s, "readonly").get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
      if (modo === "localstorage") { try { return JSON.parse(localStorage.getItem(lsKey(s, id))); } catch (e) { return null; } }
      return mem[s][id] || null;
    }
  };
})();

/* ==========================================================
   2. TRANSPORTE  (JSONP para leer, POST text/plain para enviar)
   ========================================================== */
const Api = {
  /* Camino 1: fetch directo. Apps Script permite CORS en la respuesta final,
     así que este funciona desde GitHub Pages y devuelve el error HTTP real.
     Camino 2 (respaldo): JSONP con <script>, por si una red bloquea el fetch. */
  viaFetch(params, limite) {
    const q = new URLSearchParams({ ...params, token: CONFIG.TOKEN });
    // Sin tiempo límite, una conexión de datos móviles inestable dejaba la petición
    // colgada minutos enteros. Pero 15 s era muy poco: Apps Script "en frío" más la
    // latencia de datos móviles pasa de 15 s con facilidad, y abortar ahí tiraba una
    // respuesta que venía en camino para empezar otra desde cero (Rev.42).
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const seg = Math.round((limite || 45000) / 1000);
    const reloj = ctl ? setTimeout(() => ctl.abort(), limite || 45000) : null;
    return fetch(`${CONFIG.PROXY_URL}?${q.toString()}`,
      { redirect: "follow", signal: ctl ? ctl.signal : undefined })
      .finally(() => { if (reloj) clearTimeout(reloj); })
      .catch(e => {
        throw new Error(e && e.name === "AbortError" ? "El servidor tardó más de " + seg + " s en responder" : (e.message || "Sin conexión"));
      })
      .then(async r => {
        const txt = await r.text();
        if (!r.ok) { const e = new Error("El proxy respondió HTTP " + r.status); e.servidor = true; throw e; }
        let d;
        try { d = JSON.parse(txt); }
        catch (err) { const e = new Error("Respuesta ilegible del proxy: " + txt.slice(0, 120)); e.servidor = true; throw e; }
        if (d && d.ok === false) { const e = new Error(d.error || "Error del servidor"); e.servidor = true; throw e; }
        return d;
      });
  },
  viaJsonp(params, limite) {
    return new Promise((res, rej) => {
      const cb = "jp_" + Math.random().toString(36).slice(2);
      const q = new URLSearchParams({ ...params, token: CONFIG.TOKEN, callback: cb });
      const s = document.createElement("script");
      // Si llega tarde, la función sigue existiendo y no truena con "jp_ is not defined"
      const limpiar = () => { window[cb] = () => {}; s.remove(); clearTimeout(t); };
      const t = setTimeout(() => { limpiar(); rej(new Error("El proxy no respondió a tiempo")); }, limite || 40000);
      window[cb] = d => {
        limpiar();
        if (d && d.ok === false) { const e = new Error(d.error || "Error del servidor"); e.servidor = true; rej(e); }
        else res(d);
      };
      s.onerror = () => { limpiar(); rej(new Error("El navegador no pudo cargar el proxy")); };
      s.src = `${CONFIG.PROXY_URL}?${q.toString()}`;
      document.head.appendChild(s);
    });
  },
  /* Lecturas: el fetch tiene hasta 45 s. Si a los 12 s no ha contestado, se lanza
     el JSONP EN PARALELO —sin abortar el fetch— y gana el primero que responda.
     Antes el fetch se cortaba a los 15 s y el JSONP empezaba de cero: con datos
     móviles la lista de usuarios tardaba 40 s o no llegaba nunca.
     El login no va en paralelo (crearía dos sesiones): espera al fetch y solo usa
     JSONP si la red falla de verdad. */
  get(params, opciones) {
    const paralelo = !(opciones && opciones.paralelo === false);
    if (!navigator.onLine) return Promise.reject(new Error("Sin señal. Se reintentará al reconectar."));
    return new Promise((res, rej) => {
      let hecho = false, jsonp = false, vivos = 1, errFetch = null, reloj = null;
      const ganar = d => { if (hecho) return; hecho = true; clearTimeout(reloj); res(d); };
      const perder = e => {
        if (hecho) return;
        if (e.servidor) { hecho = true; clearTimeout(reloj); return rej(e); } // el proxy contestó
        if (--vivos > 0) return;
        if (!jsonp) return lanzar();
        hecho = true; clearTimeout(reloj);
        rej(new Error(e.message + (errFetch && e !== errFetch ? " · fetch: " + errFetch.message : "")));
      };
      const lanzar = () => {
        if (jsonp || hecho) return;
        jsonp = true; vivos++; clearTimeout(reloj);
        Api.viaJsonp(params).then(ganar, perder);
      };
      Api.viaFetch(params).then(ganar, e => { errFetch = e; perder(e); });
      if (paralelo) reloj = setTimeout(lanzar, 12000);
    });
  },
  async post(body) {
    const r = await fetch(CONFIG.PROXY_URL, {
      method: "POST", redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...body, token: CONFIG.TOKEN })
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (d.ok === false) throw new Error(d.error || "El servidor rechazó el envío");
    return d;
  }
};

/* ==========================================================
   3. ESTRUCTURA DE LA ORDEN DE TRABAJO
   Los campos se enlazan al formulario por su TEXTO de pregunta;
   el qid real se resuelve contra el esquema descargado.
   ========================================================== */
const ESTADOS = ["Aguascalientes","Baja California","Baja California Sur","Campeche","Chiapas","Chihuahua","Ciudad de México","Coahuila","Colima","Durango","Estado de México","Guanajuato","Guerrero","Hidalgo","Jalisco","Michoacán","Morelos","Nayarit","Nuevo León","Oaxaca","Puebla","Querétaro","Quintana Roo","San Luis Potosí","Sinaloa","Sonora","Tabasco","Tamaulipas","Tlaxcala","Veracruz","Yucatán","Zacatecas"];
const INGENIEROS = ["Arturo Maldonado Martínez","Daniel Cortez Perez","Edson Alfonso Corona Dávalos","Erick Geovanni Serrano Espíndola","Joaquín García Rojel","Martín Parra Chino"];

const SECCIONES = [
{ id:"fecha", titulo:"Fecha de servicio", campos:[
  { k:"fechaIni", et:"Fecha de inicio", tipo:"datetime", req:true, m:{ label:"Fecha de Inicio:" } },
  { k:"fechaFin", et:"Fecha de fin",    tipo:"datetime", req:true, m:{ label:"Fecha de Fin:" } },
]},
{ id:"unidad", titulo:"Unidad médica", campos:[
  { k:"unidad",    et:"Unidad",    tipo:"texto", req:true, m:{ label:"UNIDAD:" } },
  { k:"domicilio", et:"Domicilio", tipo:"texto", req:true, m:{ label:"DOMICILIO:" } },
  { k:"telefono",  et:"Teléfono",  tipo:"tel",   req:true, m:{ label:"TELÉFONO:" } },
  { k:"entidad",   et:"Entidad",   tipo:"select", req:true, opciones:ESTADOS, m:{ label:"ENTIDAD:" } },
  { k:"email",     et:"Email",     tipo:"email", req:true, m:{ label:"EMAIL" } },
]},
{ id:"equipo", titulo:"Datos del equipo", campos:[
  { k:"equipo",    et:"Equipo",           tipo:"texto", req:true, m:{ label:"EQUIPO:" } },
  { k:"marca",     et:"Marca",            tipo:"texto", req:true, m:{ label:"MARCA:" } },
  { k:"modelo",    et:"Modelo",           tipo:"texto", req:true, m:{ label:"MODELO:" } },
  { k:"serie",     et:"Serie",            tipo:"texto", req:true, m:{ label:"SERIE:" } },
  { k:"inventario",et:"Inventario",       tipo:"texto", req:true, m:{ label:"INVENTARIO:" } },
  { k:"area",      et:"Área o ubicación", tipo:"texto", req:true, m:{ label:"ÁREA O UBICACIÓN:" } },
]},
{ id:"clasif", titulo:"Clasificación del servicio", campos:[
  { k:"tipoServicio", et:"Tipo de servicio o mantenimiento", tipo:"checks", req:true, m:{ label:"TIPO DE SERVICIO O MANTENIMIENTO" },
    opciones:["PREVENTIVO","CORRECTIVO","EVALUACIÓN","ASISTENCIA BIOMÉDICA","CURSO DE CAPACITACIÓN","GRABADO","CALIBRACIÓN","ENTREGA","INSTRUMENTAL"] },
  { k:"tipoServicioOtro", et:"Otro tipo de servicio", tipo:"texto", m:{ label:"OTRO:", nth:1 } },
  { k:"clasifRep", et:"Clasificación de la reparación", tipo:"checks", m:{ label:"CLASIFICACIÓN DE LA REPARACIÓN" },
    opciones:["REPARACIÓN ELECTRÓNICA","REPARACIÓN ELÉCTRICA","REPARACIÓN MECÁNICA","REPARACIÓN HIDRÁULICA","REPARACIÓN NEUMÁTICA"] },
  { k:"clasifRepOtro", et:"Otra clasificación", tipo:"texto", m:{ label:"OTRO:", nth:2 } },
]},
{ id:"medicion", titulo:"Equipo de medición", campos:[
  { k:"equipoMedicion", et:"Equipo de medición y/o simulador utilizado", tipo:"checks", m:{ label:"EQUIPO DE MEDICIÓN Y/O SIMULADOR UTILIZADO" },
    opciones:["ANÁLISIS EMA","RADIÓMETRO","TACÓMETRO","ELECTROCAUTERIO","SEGURIDAD ELÉCTRICA","SIGNOS VITALES (PANI, IBP, ECG, SPO2, TEMPERATURA)","DESFIBRILADOR","FLUJO Y VOLUMEN","INCUBADORA ( C, Hr, db, Lux, Caudal aire)","MARCAPASOS","PESAS","GASES","VERNIER"] },
  { k:"equipoMedicionOtro", et:"Otro equipo de medición", tipo:"texto", m:{ label:"OTRO:", nth:3 } },
  { k:"equipoCal", et:"Datos del equipo de calibración", tipo:"checks", m:{ label:"DATOS DEL EQUIPO DE CALIBRACIÓN" },
    opciones:["SEG. ELEC. ESA 612 ns: 3595053","FLUKE PROSIM8 ns: 3737639.","REMEX PARALELEPÍPEDA 10 Kg.","FLUKE VT305 ns: BF100750","FLUKE SPOT LIGHT ns: 3562069","REMEX PARALELEPÍPEDA 5 Kg.","FLUKE IMPULSE 7000 DP ns: 4430700","LT LUTRON LM-8102 ns: AG-16162","RIKEN KEIKI FI-2l ns: 378040019 ES","TACHO METER 8000 ns: 956428","DNI NEVADA 454A ESA ns:2468","TES 1333 RADIÓMETRO ns: 070508925"] },
  { k:"equipoCalOtro", et:"Otro equipo de calibración", tipo:"texto", m:{ label:"OTRO:", nth:4 } },
  { k:"documentacion", et:"Documentación generada y anexada", tipo:"checks", m:{ label:"DOCUMENTACIÓN GENERADA Y ANEXADA" },
    opciones:["RUTINA DE MANTENIMIENTO","RESULTADO DE CALIBRACIÓN","CERTIFICADO EMA"] },
  { k:"certAnio", et:"Certificado de calibración vigente, año", tipo:"select", req:true, opciones:["2024","2025","2026"], m:{ prefijo:"CERTIFICADO DE CALIBRACIÓN VIGENTE" } },
  { k:"documentacionOtro", et:"Otra documentación", tipo:"texto", m:{ label:"OTROS:" } },
]},
{ id:"descripcion", titulo:"Descripción del servicio", campos:[
  { k:"d1", et:"1. Limpieza y desinfección con pruebas de funcionamiento", tipo:"checks", req:true, m:{ prefijo:"1.-" }, opciones:["REALIZADO","N\\A"] },
  { k:"d2", et:"2. Condiciones estéticas del equipo", tipo:"checks", req:true, m:{ prefijo:"2.-" }, opciones:["REALIZADO","BUEN ESTADO","DETALLES ESTÉTICOS","N\\A"] },
  { k:"d3", et:"3. Revisión de condiciones operativas", tipo:"checks", req:true, m:{ prefijo:"3.-" }, opciones:["REALIZADO","N\\A"] },
  { k:"d4", et:"4. Reparación de equipo", tipo:"checks", req:true, m:{ prefijo:"4.-" }, opciones:["SI","NO","N\\A"] },
  { k:"d5", et:"5. Cambio de refacciones", tipo:"checks", req:true, m:{ prefijo:"5.-" }, opciones:["SI","NO","PROPORCIONADOAS POR I.A","PROPORCIONADAS POR EL CLIENTE","N\\A"] },
  { k:"d6", et:"6. Operatividad: apto para paciente", tipo:"checks", req:true, m:{ prefijo:"6.-" }, opciones:["SI","NO","FALTAN ACCESORIOS","N\\A"], negativas:["NO","FALTAN ACCESORIOS"] },
  { k:"detalle", et:"Detalle de funcionalidad", tipo:"area", req:true, m:{ label:"DETALLE DE FUNCIONALIDAD:" } },
]},
{ id:"seguimiento", titulo:"Estatus y tecnovigilancia", campos:[
  { k:"estatus", et:"Estatus de seguimiento", tipo:"checks", m:{ nombre:"escribaUna" },
    opciones:["GARANTÍA","REQUIERE COTIZACIÓN","EN CONTRATO","A PRUEBA POR 8 DÍAS","FUERA DE SERVICIO"], negativas:["FUERA DE SERVICIO"] },
  { k:"falloPaciente", et:"¿Equipo falló con paciente?", tipo:"select", opciones:["Si","No"], m:{ label:"¿EQUIPO FALLÓ CON PACIENTE?" } },
  { k:"danoPaciente",  et:"¿Equipo falló y dañó a paciente?", tipo:"select", opciones:["Si","No"], m:{ label:"¿EQUIPO FALLÓ Y DAÑO A PACIENTE?" } },
  { k:"mediciones", et:"Valores de medición", tipo:"tabla", m:{ label:"Valores de Medición" } },
  { k:"observaciones", et:"Observaciones", tipo:"area", m:{ label:"OBSERVACIONES:" } },
]},
{ id:"firmas", titulo:"Evidencia y firmas", campos:[
  { k:"fotos", et:"Evidencia fotográfica", tipo:"fotos", req:true, m:{ label:"Carga de archivo" } },
  { k:"ingeniero", et:"Ingeniero de servicio", tipo:"select", req:true, opciones:INGENIEROS, m:{ label:"INGENIERO DE SERVICIO:" } },
  { k:"firmaIng", et:"Firma del ingeniero", tipo:"firma", req:true, m:{ label:"Firma", nth:1 } },
  { k:"responsable", et:"Responsable de área", tipo:"texto", m:{ label:"RESPONSABLE DE AREA" } },
  { k:"firmaResp", et:"Firma del responsable", tipo:"firma", req:true, m:{ label:"Firma", nth:2 } },
  { k:"jefeBio", et:"Jefe de biomédica", tipo:"texto", m:{ label:"JEFE DE BIOMÉDICA" } },
  { k:"firmaJefe", et:"Firma del jefe de biomédica", tipo:"firma", req:true, m:{ label:"Firma", nth:3 } },
]},
];
const TODOS = SECCIONES.flatMap(s => s.campos);

/* ORDEN DE RENTA (Rev.45) · formulario 262980494031055
   Mismo mecanismo que la orden de trabajo: cada campo se enlaza por el texto de
   su pregunta. Donde el formulario repite el texto ("ÁREA:", "SOLICITANTE:",
   "NOMBRE RESPONSABLE:") se distingue por orden (nth) o por tipo de control (tipoQ).
   req:true = obligatorio en la app aunque Jotform no lo exija. */
const SECCIONES_RENTA = [
{ id:"r-solicitud", titulo:"Solicitud y periodo", campos:[
  { k:"solicitud",    et:"Solicitud",        tipo:"texto", req:true, m:{ label:"SOLICITUD" } },
  { k:"factura",      et:"Factura",          tipo:"texto", m:{ label:"FACTURA" } },
  { k:"inicioFecha",  et:"Fecha de inicio",  tipo:"fecha", req:true, mitad:true, m:{ label:"INICIO:" } },
  { k:"inicioHora",   et:"Hora de inicio",   tipo:"hora",  req:true, mitad:true, m:{ label:"HORA DE INICIO:" } },
  { k:"terminoFecha", et:"Fecha de término", tipo:"fecha", mitad:true, m:{ label:"TERMINO:" } },
  { k:"terminoHora",  et:"Hora de término",  tipo:"hora",  mitad:true, m:{ label:"HORA DE TERMINO:" } },
]},
{ id:"r-unidad", titulo:"Unidad médica", campos:[
  { k:"unidad",    et:"Unidad",    tipo:"texto", req:true, m:{ label:"UNIDAD:" } },
  { k:"domicilio", et:"Domicilio", tipo:"direccion", m:{ label:"DOMICILIO:" } },
  { k:"entidad",   et:"Entidad",   tipo:"select", opciones:ESTADOS, m:{ label:"ENTIDAD:" } },
  { k:"telefono",  et:"Teléfono",  tipo:"tel", m:{ label:"TELÉFONO:" } },
]},
{ id:"r-equipo", titulo:"Equipo rentado", campos:[
  { k:"equipo",      et:"Equipo",             tipo:"texto", req:true, m:{ label:"EQUIPO:" } },
  { k:"marca",       et:"Marca",              tipo:"texto", m:{ label:"MARCA:" } },
  { k:"modelo",      et:"Modelo",             tipo:"texto", m:{ label:"MODELO:" } },
  { k:"serie",       et:"Serie",              tipo:"texto", req:true, m:{ label:"SERIE:" } },
  { k:"solicitante", et:"Solicitante",        tipo:"texto", m:{ label:"SOLICITANTE:", nth:1 } },
  { k:"area",        et:"Área de ubicación",  tipo:"texto", m:{ label:"ÁREA DE UBICACIÓN:" } },
]},
{ id:"r-entrega", titulo:"Entrega y cancelación", campos:[
  { k:"entregaFecha",       et:"Fecha de entrega",      tipo:"fecha", mitad:true, m:{ label:"FECHA DE ENTREGA:" } },
  { k:"entregaHora",        et:"Hora de entrega",       tipo:"hora",  mitad:true, m:{ label:"HORA DE ENTREGA:" } },
  { k:"entregaSolicitante", et:"Solicitante (entrega)", tipo:"texto", m:{ label:"SOLICITANTE:", nth:2 } },
  { k:"entregaArea",        et:"Área (entrega)",        tipo:"texto", m:{ label:"ÁREA:", nth:1 } },
  { k:"cancelFecha",        et:"Fecha de cancelación",  tipo:"fecha", mitad:true, m:{ label:"FECHA DE CANCELACIÓN:" } },
  { k:"cancelHora",         et:"Hora de cancelación",   tipo:"hora",  mitad:true, m:{ label:"HORA DE CANCELACIÓN:" } },
  { k:"cancelo",            et:"Canceló",               tipo:"texto", m:{ label:"CANCELO:" } },
  { k:"cancelArea",         et:"Área (cancelación)",    tipo:"texto", m:{ label:"ÁREA:", nth:2 } },
]},
{ id:"r-paciente", titulo:"Paciente", campos:[
  { k:"paciente",     et:"Nombre completo",     tipo:"texto", m:{ label:"NOMBRE COMPLETO:" } },
  { k:"pacienteFN",   et:"Fecha de nacimiento", tipo:"fecha", m:{ label:"F.N.:" } },
  { k:"pacienteArea", et:"Área",                tipo:"texto", m:{ label:"ÁREA:", nth:3 } },
  { k:"registro",     et:"Registro",            tipo:"texto", m:{ label:"REGISTRO:" } },
]},
{ id:"r-cobro", titulo:"Tiempo, monto y accesorios", campos:[
  { k:"tiempoTotal", et:"Tiempo total", tipo:"texto", m:{ label:"TIEMPO TOTAL:" } },
  { k:"monto",       et:"Monto unitario sin IVA", tipo:"numero", m:{ prefijo:"MONTO UNITARIO" } },
  { k:"accesorios",  et:"Accesorios", tipo:"matriz", m:{ tipoQ:"control_matrix" },
    columnas:["Accesorio", "Piezas", "No. serie", "Observaciones"], maxFilas:6 },
]},
{ id:"r-mant", titulo:"Mantenimiento del equipo", campos:[
  { k:"preventivo",  et:"Preventivo (fecha)",          tipo:"fecha", m:{ prefijo:"PREVENTIVO" } },
  { k:"calibracion", et:"Calibración (fecha y folio)", tipo:"texto", m:{ prefijo:"CALIBRACIÓN" } },
]},
{ id:"r-firmas", titulo:"Firmas", campos:[
  { k:"ingenieroNombre",   et:"Nombre del ingeniero de servicio", tipo:"texto", req:true, m:{ label:"NOMBRE INGENIERO DE SERVICIO:" } },
  { k:"firmaIng",          et:"Firma del ingeniero de servicio",  tipo:"firma", req:true, m:{ label:"FIRMA INGENIERO DE SERVICIO" } },
  { k:"jefeNombre",        et:"Nombre del jefe de servicio",      tipo:"texto", m:{ label:"NOMBRE JEFE DE SERVICIO:" } },
  { k:"firmaJefe",         et:"Firma del jefe de área",           tipo:"firma", req:true, m:{ label:"FIRMA JEFE DE AREA:" } },
  { k:"responsableNombre", et:"Nombre del responsable",           tipo:"texto", m:{ label:"NOMBRE RESPONSABLE:", tipoQ:"control_textbox" } },
  { k:"firmaResp",         et:"Firma del responsable",            tipo:"firma", req:true, m:{ label:"NOMBRE RESPONSABLE:", tipoQ:"control_signature" } },
]},
];
const TODOS_RENTA = SECCIONES_RENTA.flatMap(s => s.campos);

/* Los dos tipos de orden que puede capturar el ingeniero. Un borrador sin "tipo"
   es una orden de trabajo: así siguen funcionando los guardados antes de Rev.45. */
const FORMULARIOS = {
  trabajo: { id: "trabajo", nombre: "Orden de trabajo", detalle: "Mantenimiento, calibración o reparación de un equipo",
             etiqueta: "OT", secciones: SECCIONES, todos: TODOS },
  renta:   { id: "renta", nombre: "Orden de renta", detalle: "Entrega, uso y retiro de un equipo en renta",
             etiqueta: "Renta", secciones: SECCIONES_RENTA, todos: TODOS_RENTA }
};
const hayRenta = () => !!CONFIG.FORM_RENTA_ID;
const tipoDe = b => (b && b.tipo === "renta") ? "renta" : "trabajo";

/* ==========================================================
   4. UTILIDADES
   ========================================================== */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = s => (s || "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase().replace(/[:.]+$/, "");
const hoyISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const horaISO = () => { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const fmtFecha = ts => { const d = new Date(ts); return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); };

/** El nombre del formulario manda: si no coincide exactamente, Jotform rechaza. */
function nombreDeFormulario(ingeniero, mapa) {
  const ops = (mapa && mapa.ingeniero && mapa.ingeniero.opciones) || [];
  const igual = ops.find(o => norm(o) === norm(ingeniero));
  return igual || "";
}

function nuevaOrden(ingeniero, tipo) {
  const v = {};
  const renta = tipo === "renta";
  (renta ? TODOS_RENTA : TODOS).forEach(c => {
    v[c.k] = c.tipo === "checks" ? [] : c.tipo === "fotos" ? [] : c.tipo === "tabla" ? [{ m: "", prog: "", desp: "", med: "" }] : c.tipo === "datetime" ? { fecha: hoyISO(), hora: horaISO() }
      : c.tipo === "matriz" ? [c.columnas.map(() => "")] : c.tipo === "direccion" ? { calle: "", colonia: "", ciudad: "", cp: "" } : "";
  });
  if (renta) {
    v.inicioFecha = hoyISO(); v.inicioHora = horaISO();
    v.ingenieroNombre = ingeniero || "";
    return { id: uid(), tipo: "renta", folio: "IAR-" + Math.floor(10000 + Math.random() * 90000),
      creada: Date.now(), actualizada: Date.now(), seccion: 0, valores: v };
  }
  v.ingeniero = ingeniero || "";
  // El folio acompaña a la orden toda su vida. Es lo que permite al proxy saber
  // si un reintento corresponde a algo que ya se registró, y así no duplicarlo.
  return { id: uid(), folio: "IAB-" + Math.floor(10000 + Math.random() * 90000),
    creada: Date.now(), actualizada: Date.now(), seccion: 0, valores: v };
}

/* ==========================================================
   ASIGNACIONES DE LA PLATAFORMA
   Coordinación asigna equipos desde «Próximos mantenimientos». Cada
   asignación llega como un borrador con los datos ya puestos. El id del
   borrador sale del id de la asignación, así nunca se duplica.
   ========================================================== */
const idBorradorAsignacion = idAsg => "asg-" + idAsg;

// Etiqueta del campo (como la manda la plataforma) → llave interna
const CAMPO_POR_ETIQUETA = (() => {
  const m = {};
  TODOS.forEach(c => { if (c.m.label) { const k = norm(c.m.label); if (!m[k]) m[k] = c.k; } });
  return m;
})();

function tiposDeServicio(texto, tipo, mapa) {
  const n = norm(texto), out = [];
  if (/PREVENT/.test(n)) out.push("PREVENTIVO");
  if (/CORRECT/.test(n)) out.push("CORRECTIVO");
  if (/CALIBR/.test(n)) out.push("CALIBRACIÓN");
  if (/EVALUA/.test(n)) out.push("EVALUACIÓN");
  if (/INSTRUMENT/.test(n)) out.push("INSTRUMENTAL");
  if (!out.length) out.push(/CALIBR/.test(norm(tipo)) ? "CALIBRACIÓN" : "PREVENTIVO");
  // Se usa el texto exacto de la opción del formulario, si ya se leyó
  const ops = (mapa && mapa.tipoServicio && mapa.tipoServicio.opciones) || [];
  return out.map(o => ops.find(x => norm(x) === norm(o)) || o);
}

function ordenDesdeAsignacion(a, ingeniero, mapa) {
  const b = nuevaOrden(nombreDeFormulario(ingeniero, mapa) || ingeniero);
  const v = b.valores, pre = a.prellenado || {};
  Object.keys(pre).forEach(et => {
    const k = CAMPO_POR_ETIQUETA[norm(et)], val = pre[et];
    if (!k || k === "ingeniero" || val == null || String(val).trim() === "") return;
    const c = TODOS.find(x => x.k === k);
    if (k === "tipoServicio") v.tipoServicio = tiposDeServicio(val, a.tipo, mapa);
    else if (c && ["texto", "tel", "email", "area", "select"].indexOf(c.tipo) > -1) v[k] = String(val).trim();
  });
  // Respaldo con las columnas de la asignación
  [["unidad", a.unidad], ["equipo", a.equipo], ["marca", a.marca], ["modelo", a.modelo],
   ["serie", a.serie], ["inventario", a.inventario], ["area", a.area]].forEach(([k, val]) => {
    if (!v[k] && val) v[k] = String(val).trim();
  });
  if (!v.tipoServicio.length) v.tipoServicio = tiposDeServicio("", a.tipo, mapa);
  if (/^\d{4}-\d{2}-\d{2}$/.test(a.fechaProgramada || "")) {
    v.fechaIni = { ...v.fechaIni, fecha: a.fechaProgramada };
    v.fechaFin = { ...v.fechaFin, fecha: a.fechaProgramada };
  }
  b.id = idBorradorAsignacion(a.id);
  b.asignacion = { id: a.id, asignadaPor: a.asignadaPor || "", fechaProgramada: a.fechaProgramada || "",
    notas: a.notas || "", tipo: a.tipo || "", huella: JSON.stringify(v) };
  return b;
}

const fechaCorta = iso => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso || "")) return "";
  return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
};

/* Resuelve cada campo contra el esquema real del formulario */
const NO_CAPTURAN = ["control_head", "control_text", "control_button", "control_pagebreak",
  "control_collapse", "control_divider", "control_image"];

function resolverMapa(preguntas, todos) {
  // Los encabezados repiten el texto de la pregunta que anuncian ("ESTATUS DE
  // SEGUIMIENTO", "INGENIERO DE SERVICIO:"). Si se enlazan, el dato se escribe
  // en un título y se pierde: por eso quedan fuera de los candidatos.
  const lista = Object.values(preguntas || {})
    .filter(q => NO_CAPTURAN.indexOf(q.type) === -1)
    .sort((a, b) => Number(a.order) - Number(b.order));
  const mapa = {}, faltantes = [];
  (todos || TODOS).forEach(c => {
    let cand;
    const base = c.m.tipoQ ? lista.filter(q => q.type === c.m.tipoQ) : lista;
    if (!c.m.nombre && !c.m.prefijo && !c.m.label) {
      cand = base;                                       // solo por tipo de control
    } else if (c.m.nombre) {
      cand = base.filter(q => q.name === c.m.nombre);
    } else if (c.m.prefijo) {
      cand = base.filter(q => norm(q.text).startsWith(norm(c.m.prefijo)));
    } else {
      const L = norm(c.m.label);
      cand = base.filter(q => norm(q.text) === L);
      if (!cand.length) cand = base.filter(q => norm(q.text).startsWith(L) || norm(q.text).includes(L));
    }
    const q = cand[(c.m.nth || 1) - 1];
    if (q) mapa[c.k] = { qid: q.qid, type: q.type, name: q.name, text: q.text,
      timeFormat: q.timeFormat, obligatorio: String(q.required) === "Yes",
      opciones: String(q.options || "").split("|").map(o => o.trim()).filter(Boolean) };
    else faltantes.push(c);
  });
  return { mapa, faltantes };
}

/* Convierte el borrador a { qid: valor } listo para el proxy */
function construirPayload(valores, mapa, todos) {
  const out = {};
  (todos || TODOS).forEach(c => {
    const m = mapa[c.k]; if (!m) return;
    let v = valores[c.k];
    if (c.tipo === "fotos") return;                       // se envían aparte
    if (c.tipo === "checks") { if (!v || !v.length) return; out[m.qid] = { tipo: "checks", valor: v }; return; }
    if (c.tipo === "datetime") { if (!v || !v.fecha) return; out[m.qid] = { tipo: "datetime", valor: v }; return; }
    if (c.tipo === "tabla") {
      const t = (v || []).filter(r => r.m || r.prog || r.desp || r.med);
      if (!t.length) return; out[m.qid] = { tipo: "tabla", valor: t }; return;
    }
    if (c.tipo === "firma") { if (!v) return; out[m.qid] = { tipo: "firma", valor: v }; return; }
    if (c.tipo === "fecha") { if (!v) return; out[m.qid] = { tipo: "datetime", valor: { fecha: v, hora: "" } }; return; }
    if (c.tipo === "hora") { if (!v) return; out[m.qid] = { tipo: "hora", valor: v }; return; }
    if (c.tipo === "direccion") {
      const d = { ...(v || {}) };
      if (!d.estado && valores.entidad) d.estado = valores.entidad;    // el estado sale de "Entidad"
      if (!d.calle && !d.colonia && !d.ciudad && !d.cp) return;
      out[m.qid] = { tipo: "direccion", valor: d }; return;
    }
    if (c.tipo === "matriz") {
      const t = (v || []).filter(f => f.some(x => String(x || "").trim()));
      if (!t.length) return; out[m.qid] = { tipo: "matriz", valor: t }; return;
    }
    if (v !== "" && v != null) out[m.qid] = { tipo: "texto", valor: String(v) };
  });
  return out;
}

// Un campo es obligatorio si lo marcamos aquí o si Jotform lo exige. Tener una
// lista propia hacía que la app dejara pasar órdenes que el formulario rechazaba.
function faltanRequeridos(valores, mapa, todos) {
  return (todos || TODOS).filter(c => {
    const exigido = c.req || (mapa && mapa[c.k] && mapa[c.k].obligatorio);
    if (!exigido) return false;
    const v = valores[c.k];
    if (c.tipo === "fotos") return !v || !v.length;
    if (c.tipo === "direccion") return !v || !String(v.calle || "").trim();
    if (c.tipo === "matriz") return !v || !v.some(f => f.some(x => String(x || "").trim()));
    if (c.tipo === "checks") {
      if (!v || !v.length) return true;
      const ops = mapa && mapa[c.k] && mapa[c.k].opciones;
      return !!(ops && ops.length && v.some(x => ops.indexOf(x) === -1));
    }
    if (c.tipo === "datetime") return !v || !v.fecha;
    if (c.tipo === "tabla") return !v || !v.filter(r => r.m || r.prog || r.desp || r.med).length;
    if (!v) return true;
    // Una opción que ya no existe en el formulario equivale a campo vacío:
    // Jotform la rechaza con "Incomplete Values".
    if (c.tipo === "select" && mapa && mapa[c.k] && mapa[c.k].opciones && mapa[c.k].opciones.length) {
      return mapa[c.k].opciones.indexOf(v) === -1;
    }
    return false;
  });
}

/* Fotos (Rev.43): se guardan como archivo (Blob) en IndexedDB, no como texto
   base64. Ocupan un 33% menos, no se copian como cadenas gigantes cada vez que se
   autoguarda el borrador y la miniatura se muestra sin decodificar texto. Solo se
   convierten a base64 en el momento de enviarlas al servidor.
   Si el teléfono no admite Blob en IndexedDB (o se usa localStorage), se queda
   el formato anterior, dataUrl, que sigue siendo válido en todo el código. */
/* El formulario pide el monto "con número y letra", pero en Jotform es un campo
   numérico: la letra se muestra aquí como ayuda para revisar la cantidad. */
function montoEnLetra(n) {
  if (!isFinite(n) || n < 0 || n >= 1e9) return "";
  const U = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
    "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiún",
    "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
  const D = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const C = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos",
    "setecientos", "ochocientos", "novecientos"];
  const cientos = x => {
    if (x === 100) return "cien";
    const c = Math.floor(x / 100), r = x % 100;
    const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? " y " + U[r % 10] : "");
    return [C[c], dec].filter(Boolean).join(" ");
  };
  const entero = Math.floor(n), cent = Math.round((n - entero) * 100);
  const mill = Math.floor(entero / 1e6), miles = Math.floor((entero % 1e6) / 1000), resto = entero % 1000;
  const partes = [];
  if (mill) partes.push(mill === 1 ? "un millón" : cientos(mill) + " millones");
  if (miles) partes.push(miles === 1 ? "mil" : cientos(miles) + " mil");
  if (resto) partes.push(cientos(resto));
  const txt = (partes.join(" ") || "cero") + (mill && !miles && !resto ? " de" : "");
  return txt.charAt(0).toUpperCase() + txt.slice(1) + " pesos " + String(cent).padStart(2, "0") + "/100 M.N.";
}

async function comprimirImagen(file, max = 1400, calidad = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const esc = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(img.width * esc); cv.height = Math.round(img.height * esc);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    if (Store.aceptaBlob && cv.toBlob) {
      const blob = await new Promise(res => cv.toBlob(res, "image/jpeg", calidad));
      if (blob) return { blob };
    }
    return { dataUrl: cv.toDataURL("image/jpeg", calidad) };
  } finally { URL.revokeObjectURL(url); }
}

function aDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

/** Miniatura de una foto en cualquiera de los dos formatos. */
function Miniatura({ foto }) {
  const [src, setSrc] = useState(foto.dataUrl || "");
  useEffect(() => {
    if (!foto.blob) { setSrc(foto.dataUrl || ""); return; }
    const u = URL.createObjectURL(foto.blob); setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [foto]);
  return src ? <img src={src} alt="" /> : null;
}

/* ==========================================================
   5. CAMPOS
   ========================================================== */
function Etiqueta({ c, obligatorio }) {
  return <span className="lb">{c.et}{(c.req || obligatorio) && <em> *</em>}</span>;
}

function Campo({ c, valor, set, obligatorio, opciones }) {
  if (c.tipo === "texto" || c.tipo === "tel" || c.tipo === "email")
    return <label className="f"><Etiqueta c={c} obligatorio={obligatorio} />
      <input type={c.tipo === "texto" ? "text" : c.tipo} value={valor || ""} onChange={e => set(e.target.value)}
        inputMode={c.tipo === "tel" ? "tel" : undefined} autoComplete="off" /></label>;

  if (c.tipo === "area")
    return <label className="f"><Etiqueta c={c} obligatorio={obligatorio} /><textarea value={valor || ""} onChange={e => set(e.target.value)} /></label>;

  if (c.tipo === "select") {
    const ops = (opciones && opciones.length) ? opciones : c.opciones;
    const invalido = valor && ops.indexOf(valor) === -1;
    return <label className="f"><Etiqueta c={c} obligatorio={obligatorio} />
      <select value={invalido ? "" : (valor || "")} onChange={e => set(e.target.value)}>
        <option value="">Seleccione</option>
        {ops.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {invalido && <span className="error-campo">
        "{valor}" ya no es una opción válida del formulario. Elija una de la lista.
      </span>}</label>;
  }

  if (c.tipo === "datetime") {
    const v = valor || { fecha: "", hora: "" };
    return <div className="f"><Etiqueta c={c} obligatorio={obligatorio} />
      <div className="row">
        <input type="date" value={v.fecha || ""} onChange={e => set({ ...v, fecha: e.target.value })} />
        <input type="time" value={v.hora || ""} onChange={e => set({ ...v, hora: e.target.value })} />
      </div></div>;
  }

  if (c.tipo === "fecha" || c.tipo === "hora")
    return <label className="f"><Etiqueta c={c} obligatorio={obligatorio} />
      <input type={c.tipo === "fecha" ? "date" : "time"} value={valor || ""} onChange={e => set(e.target.value)} /></label>;

  if (c.tipo === "numero")
    return <label className="f"><Etiqueta c={c} obligatorio={obligatorio} />
      <input type="text" inputMode="decimal" value={valor || ""} placeholder="0.00"
        onChange={e => set(e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))} />
      {valor && !isNaN(Number(valor)) && <span className="ayuda-campo">{montoEnLetra(Number(valor))}</span>}</label>;

  if (c.tipo === "direccion") {
    const d = valor || {};
    const pon = (k, x) => set({ ...d, [k]: x });
    return <div className="f"><Etiqueta c={c} obligatorio={obligatorio} />
      <input type="text" placeholder="Calle y número" value={d.calle || ""} onChange={e => pon("calle", e.target.value)} autoComplete="off" />
      <input type="text" className="mt8" placeholder="Colonia" value={d.colonia || ""} onChange={e => pon("colonia", e.target.value)} autoComplete="off" />
      <div className="row mt8">
        <input type="text" placeholder="Alcaldía o municipio" value={d.ciudad || ""} onChange={e => pon("ciudad", e.target.value)} autoComplete="off" />
        <input type="text" inputMode="numeric" maxLength={5} placeholder="C.P." className="cp"
          value={d.cp || ""} onChange={e => pon("cp", e.target.value.replace(/\D/g, ""))} />
      </div></div>;
  }

  if (c.tipo === "matriz") {
    const filas = valor && valor.length ? valor : [c.columnas.map(() => "")];
    const cambiar = (i, j, x) => set(filas.map((f, a) => a === i ? f.map((y, b) => b === j ? x : y) : f));
    return <div className="f"><Etiqueta c={c} obligatorio={obligatorio} />
      {filas.map((f, i) => <div className="renglon-matriz" key={i}>
        <div className="renglon-cab"><span>{c.columnas[0]} {i + 1}</span>
          {filas.length > 1 && <button type="button" className="btn ghost cuadrado"
            onClick={() => set(filas.filter((_, a) => a !== i))} aria-label="Quitar renglón">×</button>}</div>
        <div className="rejilla-matriz">
          {c.columnas.map((col, j) => <input key={j} type="text" placeholder={col} value={f[j] || ""}
            inputMode={/PIEZAS/i.test(col) ? "numeric" : undefined}
            className={j === 0 || j === c.columnas.length - 1 ? "ancho" : ""}
            onChange={e => cambiar(i, j, e.target.value)} />)}
        </div>
      </div>)}
      {filas.length < (c.maxFilas || 6) && <button type="button" className="btn ghost mt8"
        onClick={() => set([...filas, c.columnas.map(() => "")])}>+ Agregar {c.columnas[0].toLowerCase()}</button>}
    </div>;
  }

  if (c.tipo === "checks") {
    const ops = (opciones && opciones.length) ? opciones : c.opciones;
    const sel = valor || [];
    const alternar = o => set(sel.includes(o) ? sel.filter(x => x !== o) : [...sel, o]);
    // Se compara sin acentos ni espacios raros para saber si una opción guardada
    // sigue siendo válida: en el formulario hay valores con tabuladores dentro.
    const sueltas = sel.filter(v => ops.indexOf(v) === -1);
    return <div className="f"><Etiqueta c={c} obligatorio={obligatorio} />
      <div className="chips">
        {ops.map(o =>
          <button key={o} type="button" className={"chip" + ((c.negativas || []).some(n => norm(n) === norm(o)) ? " neg" : "")}
            aria-pressed={sel.includes(o)} onClick={() => alternar(o)}>{o.replace(/\s+/g, " ").trim()}</button>)}
      </div>
      {!!sueltas.length && <span className="error-campo">
        Hay opciones marcadas que ya no existen en el formulario. Vuelva a marcarlas arriba.
      </span>}</div>;
  }

  if (c.tipo === "tabla") {
    const filas = valor && valor.length ? valor : [{ m: "", prog: "", desp: "", med: "" }];
    const cambiar = (i, k, val) => set(filas.map((f, j) => j === i ? { ...f, [k]: val } : f));
    return <div className="f"><Etiqueta c={c} obligatorio={obligatorio} />
      <table className="med">
        <thead><tr><th>Medición</th><th>Valor programado</th><th>Valor desplegado</th><th>Valor medido</th><th></th></tr></thead>
        <tbody>{filas.map((f, i) =>
          <tr key={i}>
            <td><input type="text" value={f.m} onChange={e => cambiar(i, "m", e.target.value)} /></td>
            <td><input type="text" value={f.prog} onChange={e => cambiar(i, "prog", e.target.value)} /></td>
            <td><input type="text" value={f.desp} onChange={e => cambiar(i, "desp", e.target.value)} /></td>
            <td><input type="text" value={f.med} onChange={e => cambiar(i, "med", e.target.value)} /></td>
            <td><button type="button" className="btn ghost cuadrado"
              onClick={() => set(filas.filter((_, j) => j !== i))}>×</button></td>
          </tr>)}</tbody>
      </table>
      <button type="button" className="btn ghost mt8"
        onClick={() => set([...filas, { m: "", prog: "", desp: "", med: "" }])}>+ Agregar medición</button>
    </div>;
  }

  if (c.tipo === "firma") return <FirmaCampo c={c} valor={valor} set={set} obligatorio={obligatorio} />;
  if (c.tipo === "fotos") return <FotosCampo c={c} valor={valor} set={set} obligatorio={obligatorio} />;
  return null;
}

function FirmaCampo({ c, valor, set, obligatorio }) {
  const ref = useRef(null), dib = useRef(false), ult = useRef(null);
  const preparar = useCallback(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    if (cv.width === Math.round(r.width * dpr)) return;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr); ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0B1116";
    if (valor) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = valor; }
  }, [valor]);
  useEffect(() => { preparar(); window.addEventListener("resize", preparar); return () => window.removeEventListener("resize", preparar); }, [preparar]);

  const pos = e => { const r = ref.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const abajo = e => { e.preventDefault(); ref.current.setPointerCapture(e.pointerId); dib.current = true; ult.current = pos(e); };
  const mover = e => {
    if (!dib.current) return;
    const ctx = ref.current.getContext("2d"), p = pos(e);
    ctx.beginPath(); ctx.moveTo(ult.current.x, ult.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ult.current = p;
  };
  const arriba = () => { if (!dib.current) return; dib.current = false; set(ref.current.toDataURL("image/png")); };
  const limpiar = () => { const cv = ref.current, ctx = cv.getContext("2d"); ctx.clearRect(0, 0, cv.width, cv.height); set(""); };

  return <div className="f"><Etiqueta c={c} obligatorio={obligatorio} />
    <div className="sigwrap">
      <canvas ref={ref} onPointerDown={abajo} onPointerMove={mover} onPointerUp={arriba} onPointerLeave={arriba} />
      {!valor && <div className="sighint">Firme aquí</div>}
    </div>
    <button type="button" className="btn ghost mt8" onClick={limpiar}>Borrar firma</button>
  </div>;
}

function FotosCampo({ c, valor, set, obligatorio }) {
  const [cargando, setCargando] = useState(false);
  const fotos = valor || [];
  const agregar = async e => {
    const files = Array.from(e.target.files || []); e.target.value = "";
    if (!files.length) return;
    setCargando(true);
    const nuevas = [];
    for (const f of files) { try { nuevas.push({ id: uid(), nombre: f.name, ...(await comprimirImagen(f)) }); } catch (err) {} }
    set([...fotos, ...nuevas]); setCargando(false);
  };
  return <div className="f"><Etiqueta c={c} obligatorio={obligatorio} />
    <label className="btn ghost block clic">
      {cargando ? <span className="spin" /> : "Agregar fotos"}
      <input className="oculto" type="file" accept="image/*" multiple onChange={agregar} />
    </label>
    {!!fotos.length && <div className="thumbs">{fotos.map(f =>
      <div className="thumb" key={f.id}><Miniatura foto={f} />
        <button type="button" onClick={() => set(fotos.filter(x => x.id !== f.id))}>×</button></div>)}</div>}
  </div>;
}

/* ==========================================================
   6. PANTALLAS
   ========================================================== */
function Identificacion({ onEntrar, usuarios, recargar, cargando, errorCarga }) {
  const [n, setN] = useState("");
  const [nip, setNip] = useState("");
  const [err, setErr] = useState("");
  const [validando, setValidando] = useState(false);

  const entrar = async () => {
    setValidando(true); setErr("");
    const e = await onEntrar(n, nip);
    if (e) { setErr(e); setNip(""); }
    setValidando(false);
  };

  return <main>
    <div className="center">
      <img src="icon-192.png" alt="" className="logo-acceso" onError={e => { e.currentTarget.style.display = "none"; }} />
      <div className="acceso-marca">Ingenieros Asociados</div>
      <h1 className="acceso-titulo">Orden de Trabajo</h1>
      <p className="lead acceso-lead">Elija su usuario y escriba su NIP de 4 dígitos.</p>

      <div className="acceso-form">
        <select value={n} onChange={e => { setN(e.target.value); setErr(""); }}>
          <option value="">Seleccione usuario</option>
          {/* Primera apertura sin lista guardada: se muestran los ingenieros conocidos
              mientras responde el servidor, para no dejar la pantalla vacía. El NIP
              lo valida el servidor de todos modos. */}
          {(usuarios.length ? usuarios : INGENIEROS.map(nombre => ({ nombre })))
            .map(u => <option key={u.nombre} value={u.nombre}>{u.nombre}</option>)}
        </select>

        <input type="password" inputMode="numeric" maxLength={4} value={nip} className="nip mt12"
          onChange={e => setNip(e.target.value.replace(/\D/g, ""))}
          placeholder="• • • •" />

        {err && <div className="note bad mt10">{err}</div>}

        <button className="btn primary block mt12"
          disabled={!n || nip.length !== 4 || validando} onClick={entrar}>
          {validando ? <span className="spin" /> : "Entrar"}</button>

        {!usuarios.length && <>
          {cargando
            ? <div className="note mt12"><span className="spin" /> Conectando con el servidor… con datos móviles la primera vez puede tardar hasta un minuto.</div>
            : errorCarga && <div className="note bad mt12">
                No se pudo obtener la lista de usuarios.<br />
                <span className="mono12">{errorCarga}</span>
              </div>}
          <button className="btn ghost block mt10" onClick={recargar} disabled={cargando}>
            {cargando ? <span className="spin" /> : "Reintentar"}</button>
        </>}
      </div>
    </div>
  </main>;
}

function Formulario({ borrador, guardar, enviar, cancelar, mapa, faltantes, def }) {
  const SECS = (def || FORMULARIOS.trabajo).secciones, CAMPOS = (def || FORMULARIOS.trabajo).todos;
  // Si el nombre del usuario no está entre las opciones del formulario, la orden
  // será rechazada por Jotform: más vale avisarlo desde el primer paso.
  const opsIng = (mapa.ingeniero && mapa.ingeniero.opciones) || [];
  const [v, setV] = useState(borrador.valores);
  const [sec, setSec] = useState(borrador.seccion || 0);
  const [errs, setErrs] = useState([]);
  const timer = useRef(null);

  const set = (k, val) => setV(prev => ({ ...prev, [k]: val }));

  useEffect(() => { // autoguardado
    clearTimeout(timer.current);
    timer.current = setTimeout(() => guardar({ ...borrador, valores: v, seccion: sec, actualizada: Date.now() }, true), 700);
    return () => clearTimeout(timer.current);
  }, [v, sec]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [sec]);

  const S = SECS[sec] || SECS[0], ultima = sec === SECS.length - 1;
  const sinNombre = !!opsIng.length && !!v.ingeniero && opsIng.indexOf(v.ingeniero) === -1;
  const sinMapear = S.campos.filter(c => faltantes.some(f => f.k === c.k));

  const intentarEnviar = () => {
    const f = faltanRequeridos(v, mapa, CAMPOS);
    if (f.length) {
      setErrs(f); const i = SECS.findIndex(s => s.campos.some(c => c.k === f[0].k)); setSec(i);
      // Si lo que falta está en este mismo paso, el paso no cambia y la pantalla
      // se quedaba abajo: el aviso de "Faltan campos" no se veía (Rev.44).
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setErrs([]); enviar({ ...borrador, valores: v, seccion: sec, actualizada: Date.now() });
  };

  return <main>
    <div className="steps">{SECS.map((s, i) => <b key={s.id} className={i < sec ? "done" : i === sec ? "now" : ""} />)}</div>
    {hayRenta() && <div className={"tipo-orden " + tipoDe(borrador)}>{(def || FORMULARIOS.trabajo).nombre}</div>}
    <h2>{S.titulo}</h2>
    <p className="lead">Paso {sec + 1} de {SECS.length} · se guarda solo mientras escribe</p>

    {!!errs.length && <div className="note bad">Faltan campos obligatorios: {errs.map(e => e.et).join(", ")}.</div>}
    {borrador.asignacion && sec === 0 && <div className="note">
      <b>Asignada por coordinación</b>{borrador.asignacion.asignadaPor ? " (" + borrador.asignacion.asignadaPor + ")" : ""}
      {borrador.asignacion.fechaProgramada ? " para el " + fechaCorta(borrador.asignacion.fechaProgramada) : ""}.
      Los datos de la unidad y del equipo ya vienen llenos; revíselos contra la placa del equipo.
      {borrador.asignacion.notas && <><br /><b>Indicaciones:</b> {borrador.asignacion.notas}</>}
    </div>}
    {sinNombre && <div className="note bad">
      Su usuario no coincide con ningún ingeniero de la lista del formulario, así que la orden
      no se puede enviar a su nombre. Elija uno en el paso de firmas o pida a coordinación que
      corrija su nombre en Gestionar usuarios.
    </div>}
    {!!sinMapear.length && <div className="note">Estos campos no se encontraron en el formulario de Jotform y no se enviarán: {sinMapear.map(c => c.et).join(", ")}. Revise la pestaña Ajustes.</div>}

    <div className="card rejilla">
      {S.campos.map(c => <div key={c.k} className={"celda" + (c.mitad ? " mitad" : "")}>
        <Campo c={c} valor={v[c.k]} set={val => set(c.k, val)}
          obligatorio={!!(mapa[c.k] && mapa[c.k].obligatorio)}
          opciones={mapa[c.k] && mapa[c.k].opciones} /></div>)}
    </div>

    <div className="actions">
      {sec > 0 && <button className="btn" onClick={() => setSec(sec - 1)}>Atrás</button>}
      {ultima
        ? <button className="btn primary" onClick={intentarEnviar}>Enviar orden</button>
        : <button className="btn primary" onClick={() => setSec(sec + 1)}>Siguiente</button>}
    </div>
    {/* Salir está disponible en cualquier paso: lo capturado ya quedó guardado */}
    <button className="btn ghost block mt10"
      onClick={() => { guardar({ ...borrador, valores: v, seccion: sec, actualizada: Date.now() }); cancelar(); }}>
      Salir y continuar después
    </button>
  </main>;
}

function ListaBorradores({ borradores, abrir, borrar, nuevo, datosForm, enviar, cola, enviando, reintentar,
  devolver, deOtros, verTodos, alternarTodos }) {
  const [eligiendo, setEligiendo] = useState(false);
  const etiqueta = b => hayRenta() && <span className={"tag tipo " + tipoDe(b)}>{FORMULARIOS[tipoDe(b)].etiqueta}</span>;
  return <main>
    <h2>Borradores</h2>
    <p className="lead">Órdenes sin terminar guardadas en este teléfono. Nada se pierde si cierra la app o se queda sin señal.</p>
    {/* Con dos formularios, el ingeniero elige primero qué orden va a capturar */}
    {!hayRenta()
      ? <button className="btn primary block mb14" onClick={() => nuevo("trabajo")}>Nueva orden de trabajo</button>
      : !eligiendo
        ? <button className="btn primary block mb14" onClick={() => setEligiendo(true)}>Nueva orden</button>
        : <div className="eleccion mb14">
            <div className="eleccion-tit">¿Qué orden va a capturar?</div>
            {["trabajo", "renta"].map(t => <button key={t} className={"opcion-orden " + t}
              onClick={() => { setEligiendo(false); nuevo(t); }}>
              <b>{FORMULARIOS[t].nombre}</b><span>{FORMULARIOS[t].detalle}</span></button>)}
            <button className="btn ghost block" onClick={() => setEligiendo(false)}>Cancelar</button>
          </div>}

    {/* Un borrador capturado con otro usuario nunca debe parecer perdido */}
    {!!deOtros && <div className="note">
      Hay {deOtros} borrador(es) capturado(s) con otro usuario en este dispositivo.
      <button className="btn ghost block mt8" onClick={alternarTodos}>
        {verTodos ? "Ver solo los míos" : "Mostrarlos"}</button>
    </div>}

    {/* Las órdenes en cola solo esperan señal: el resto vuelve solo a borradores */}
    {!!cola.length && <>
      <h2 className="mt4">Esperando señal</h2>
      <p className="lead">Se envían solas al reconectar.</p>
      <button className="btn block mb10" disabled={enviando} onClick={reintentar}>
        {enviando ? <><span className="spin" /> Enviando…</> : "Intentar ahora"}</button>
      {cola.map(o => <div className="item" key={o.id}>
        <div className="body">
          <div className="t">{etiqueta(o)}{o.valores.equipo || "Equipo"}</div>
          <div className="s">{o.folio ? o.folio + " · " : ""}{o.valores.unidad || "—"}<br />
            {o.error ? <span className="txt-alerta">{o.error}</span> : "En espera de conexión"}</div>
        </div>
        <button className="btn ghost mini" onClick={() => devolver(o.id)}>
          A borradores</button>
      </div>)}
      <h2 className="mt18">Sin terminar</h2>
    </>}
    {!borradores.length
      ? <div className="empty">No hay borradores.<br />Empiece una orden y quedará aquí en cuanto escriba el primer dato.</div>
      : borradores.map(b => {
        const F = datosForm(tipoDe(b)), v = b.valores, pend = faltanRequeridos(v, F.mapa, F.def.todos).length;
        return <div className="item col" key={b.id}>
          <div className="fila-item">
            <div className="body clic" onClick={() => abrir(b)}>
              <div className="t">{etiqueta(b)}{v.equipo || "Equipo sin capturar"}</div>
              <div className="s">{v.unidad || "Unidad sin capturar"} · {tipoDe(b) === "renta"
                ? (v.serie ? "serie " + v.serie : "s/serie") : (v.inventario || "s/inv")}<br />
              {b.folio ? b.folio + " · " : ""}Editado {fmtFecha(b.actualizada)}</div>
            {b.asignacion && !b.asignacion.cancelada && <div className="s mt5">
              <span className="tag asg">Asignada{b.asignacion.fechaProgramada ? " · " + fechaCorta(b.asignacion.fechaProgramada) : ""}</span>
              {b.asignacion.notas && <> {b.asignacion.notas}</>}</div>}
            {b.asignacion && b.asignacion.cancelada && <div className="s txt-alerta mt5">
              Coordinación canceló esta asignación. Puede eliminar el borrador.</div>}
            {b.errorEnvio && <div className="s txt-alerta mt5">
              No se envió: {b.errorEnvio}</div>}
            </div>
            <div className="col-fin">
              <span className={"tag " + (pend ? "pend" : "ok")}>{pend ? pend + " pend." : "lista"}</span>
              <button className="btn danger ghost mini" onClick={() => borrar(b.id)}>Eliminar</button>
            </div>
          </div>
          {/* Una orden completa se puede mandar sin volver a abrirla paso por paso */}
          {!pend && <button className="btn primary block mt10"
            onClick={() => enviar(b)}>{b.errorEnvio ? "Reintentar el envío" : "Enviar esta orden"}</button>}
        </div>;
      })}
  </main>;
}

function MisEnvios({ ingeniero, enviados, cargar, cargando, error }) {
  const [abierta, setAbierta] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errDetalle, setErrDetalle] = useState("");
  const [anio, setAnio] = useState("");
  const [mes, setMes] = useState("");
  const [hospital, setHospital] = useState("");
  const [texto, setTexto] = useState("");
  useEffect(() => { cargar(); }, []);

  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

  // Las opciones salen de los envíos reales, así nunca se ofrece un filtro vacío.
  const { anios, meses, hospitales } = useMemo(() => {
    const a = new Set(), m = new Set(), h = new Set();
    enviados.forEach(s => {
      const d = new Date(s.created_at);
      a.add(String(d.getFullYear()));
      if (!anio || String(d.getFullYear()) === anio) m.add(String(d.getMonth()));
      if (s.unidad) h.add(s.unidad.trim());
    });
    return {
      anios: [...a].sort((x, y) => y - x),
      meses: [...m].sort((x, y) => x - y),
      hospitales: [...h].sort((x, y) => x.localeCompare(y))
    };
  }, [enviados, anio]);

  const lista = useMemo(() => enviados.filter(s => {
    const d = new Date(s.created_at);
    if (anio && String(d.getFullYear()) !== anio) return false;
    if (mes && String(d.getMonth()) !== mes) return false;
    if (hospital && (s.unidad || "").trim() !== hospital) return false;
    if (texto) {
      const t = texto.toLowerCase();
      const campos = [s.equipo, s.unidad, s.inventario, s.serie, s.folio].join(" ").toLowerCase();
      if (campos.indexOf(t) === -1) return false;
    }
    return true;
  }), [enviados, anio, mes, hospital, texto]);

  const limpiar = () => { setAnio(""); setMes(""); setHospital(""); setTexto(""); };

  const abrir = async s => {
    setAbierta(s); setDetalle(null); setErrDetalle(""); setCargandoDetalle(true);
    try {
      const d = await Api.get({ action: "detalle", fila: s.fila, form: s.form || "trabajo" });
      setDetalle(d.respuestas || []);
    } catch (e) { setErrDetalle("No se pudo abrir el detalle: " + e.message); }
    setCargandoDetalle(false);
  };
  const filtrando = anio || mes || hospital || texto;

  if (abierta) return <main>
    <button className="btn ghost mb12" onClick={() => setAbierta(null)}>← Volver</button>
    <h2>{abierta.folio || "Envío " + abierta.id}</h2>
    <p className="lead">
      {abierta.equipo || "Equipo"} · {abierta.unidad || "—"}<br />
      {abierta.created_at ? new Date(abierta.created_at).toLocaleString("es-MX") : ""}
    </p>
    {errDetalle && <div className="note bad">{errDetalle}</div>}
    {cargandoDetalle
      ? <div className="empty"><span className="spin" /> Abriendo la orden…</div>
      : detalle && <div className="card"><div className="kv">
          {detalle.map((r, i) => <div key={i}><b>{r.pregunta}:</b> {r.valor}</div>)}
        </div></div>}
  </main>;

  return <main>
    <h2>Mis envíos</h2>
    <p className="lead">Órdenes registradas en Jotform a nombre de {ingeniero.split(" ")[0]}.</p>

    <div className="card tight">
      <div className="row">
        <select value={anio} onChange={e => { setAnio(e.target.value); setMes(""); }}>
          <option value="">Todos los años</option>
          {anios.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={mes} onChange={e => setMes(e.target.value)}>
          <option value="">Todos los meses</option>
          {meses.map(m => <option key={m} value={m}>{MESES[Number(m)]}</option>)}
        </select>
      </div>
      <select className="mt10" value={hospital} onChange={e => setHospital(e.target.value)}>
        <option value="">Todas las unidades médicas</option>
        {hospitales.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
      <input className="mt10" type="text" placeholder="Buscar equipo, inventario o folio" value={texto}
        onChange={e => setTexto(e.target.value)} />
      <div className="actions mt10">
        <button className="btn ghost" onClick={cargar} disabled={cargando}>
          {cargando ? <><span className="spin" /> Consultando…</> : "Actualizar"}</button>
        {filtrando && <button className="btn ghost" onClick={limpiar}>Quitar filtros</button>}
      </div>
    </div>

    {error && <div className="note bad">{error}</div>}

    <p className="lead mb10">
      {cargando ? "Consultando el historial…"
        : lista.length === enviados.length
          ? `${enviados.length} orden${enviados.length === 1 ? "" : "es"} en total`
          : `${lista.length} de ${enviados.length} órdenes`}
    </p>

    {!cargando && !enviados.length && !error &&
      <div className="empty">Todavía no hay envíos a su nombre, o no hay conexión para consultarlos.</div>}
    {!cargando && enviados.length > 0 && !lista.length &&
      <div className="empty">Ninguna orden coincide con los filtros.</div>}

    {lista.map(s => <div className="item clic" key={(s.form || "trabajo") + s.fila} onClick={() => abrir(s)}>
      <div className="body">
        <div className="t">{s.form === "renta" && <span className="tag tipo renta">Renta</span>}{s.equipo || "Equipo"}</div>
        <div className="s">{s.folio ? s.folio + " · " : ""}{s.unidad || "—"} · {s.form === "renta"
          ? (s.serie ? "serie " + s.serie : "s/serie") : (s.inventario || "s/inv")}<br />
          {s.created_at ? new Date(s.created_at).toLocaleString("es-MX") : "sin fecha"}</div>
      </div>
      <span className="tag ok">enviada</span>
    </div>)}
  </main>;
}

function Avisos({ ingeniero, avisos, cargar, cargando, error, esCoordinador, ingenieros, guardar }) {
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState({ destinatario: "TODOS", tipo: "informativo", titulo: "", mensaje: "" });
  useEffect(() => { cargar(); }, []);

  const abrirNuevo = () => {
    setAviso({ destinatario: "TODOS", tipo: "informativo", titulo: "", mensaje: "" });
    setEditando("nuevo");
  };
  const abrirEdicion = a => {
    setAviso({ fila: a.fila, destinatario: a.destinatario, tipo: a.tipo, titulo: a.titulo, mensaje: a.mensaje });
    setEditando(a.id);
  };
  const publicar = async () => {
    setGuardando(true);
    const ok = await guardar({ ...aviso, activo: true });
    setGuardando(false);
    if (ok) setEditando(null);
  };
  const alternar = async a => { await guardar({ fila: a.fila, activo: !a.activo }); };

  if (editando) return <main>
    <button className="btn ghost mb12" onClick={() => setEditando(null)}>← Volver</button>
    <h2>{editando === "nuevo" ? "Nuevo aviso" : "Editar aviso"}</h2>
    <p className="lead">Aparece en la pestaña Avisos del ingeniero asignado.</p>
    <div className="card">
      <label className="f"><span className="lb">Para <em>*</em></span>
        <select value={aviso.destinatario} onChange={e => setAviso({ ...aviso, destinatario: e.target.value })}>
          <option value="TODOS">Todo el equipo</option>
          {ingenieros.map(i => <option key={i} value={i}>{i}</option>)}
        </select></label>
      <label className="f"><span className="lb">Tipo</span>
        <select value={aviso.tipo} onChange={e => setAviso({ ...aviso, tipo: e.target.value })}>
          <option value="informativo">Informativo</option>
          <option value="mantenimiento">Mantenimiento asignado</option>
          <option value="urgente">Urgente</option>
        </select></label>
      <label className="f"><span className="lb">Título <em>*</em></span>
        <input type="text" value={aviso.titulo} onChange={e => setAviso({ ...aviso, titulo: e.target.value })}
          placeholder="Mantenimientos de la semana" /></label>
      <label className="f"><span className="lb">Mensaje <em>*</em></span>
        <textarea className="alto150" value={aviso.mensaje} onChange={e => setAviso({ ...aviso, mensaje: e.target.value })} placeholder="Un equipo por renglón, con su ubicación y fecha programada" /></label>
      <button className="btn primary block" disabled={!aviso.titulo.trim() || !aviso.mensaje.trim() || guardando}
        onClick={publicar}>{guardando ? <span className="spin" /> : "Publicar aviso"}</button>
    </div>
  </main>;

  return <main>
    <h2>Avisos</h2>
    <p className="lead">{esCoordinador
      ? "Comunicados publicados para el equipo."
      : "Comunicados y asignaciones para " + ingeniero.split(" ")[0] + "."}</p>

    {esCoordinador && <button className="btn primary block mb10" onClick={abrirNuevo}>
      Nuevo aviso</button>}
    <button className="btn ghost block mb14" onClick={cargar} disabled={cargando}>
      {cargando ? <><span className="spin" /> Consultando…</> : "Actualizar"}</button>

    {error && <div className="note bad">{error}</div>}
    {!cargando && !avisos.length && !error && <div className="empty">No hay avisos por ahora.</div>}

    {avisos.map(a => <div className={"aviso " + (a.tipo || "informativo") + (a.activo === false ? " apagado" : "")} key={a.id}>
      <h3>{a.titulo || "Aviso"}</h3>
      {a.mensaje && <p>{a.mensaje}</p>}
      <div className="meta">
        {a.fecha ? new Date(a.fecha).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" }) : ""}
        {esCoordinador
          ? " · para " + (a.paraTodos ? "todo el equipo" : a.destinatario) + (a.activo === false ? " · oculto" : "")
          : (a.paraTodos ? " · para todo el equipo" : " · personal")}
      </div>
      {esCoordinador && <div className="actions mt10">
        <button className="btn ghost compacto t13" onClick={() => abrirEdicion(a)}>Editar</button>
        <button className="btn ghost compacto t13" onClick={() => alternar(a)}>
          {a.activo === false ? "Mostrar" : "Ocultar"}</button>
      </div>}
    </div>)}
  </main>;
}

const COLUMNAS = [
  { k: "asignada", n: "Asignada" },
  { k: "en_proceso", n: "En proceso" },
  { k: "terminada", n: "Terminada" },
  { k: "con_observacion", n: "Con observación" }
];
const PRIORIDADES = [
  { k: "alta", n: "Alta" },
  { k: "media", n: "Media" },
  { k: "baja", n: "Baja" }
];
const MESES_N = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function Tablero({ tareas, cargar, cargando, error, esAdmin, esVisualizador, yo, ingenieros, guardar, mover, eliminar,
  enviarReporte, enviandoRep, enviarUbicaciones, enviandoUbic }) {
  const [filtros, setFiltros] = useState({ desde: "", hasta: "", ingeniero: "", estado: "", prioridad: "" });
  const [correoDestino, setCorreoDestino] = useState("");
  const [correoUbic, setCorreoUbic] = useState("");
  const [vista, setVista] = useState(esVisualizador ? "ingeniero" : "tablero");
  // En el perfil de consulta la tarjeta se identifica por dónde está el trabajo
  const rotulo = x => esVisualizador ? (x.ubicacion || "Sin ubicación") : x.titulo;
  const [abierta, setAbierta] = useState(null);
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [observando, setObservando] = useState(false);
  const [comentario, setComentario] = useState("");
  const [mes, setMes] = useState(() => { const d = new Date(); return { a: d.getFullYear(), m: d.getMonth() }; });
  const [dia, setDia] = useState("");
  const [t, setT] = useState({});
  useEffect(() => { cargar(); }, []);

  const vacia = { titulo: "", inicio: hoyISO(), fin: hoyISO(), ubicacion: "",
    observaciones: "", prioridad: "baja", asignado: "", estado: "asignada" };

  const aplicar = async () => {
    setGuardando(true);
    const ok = await guardar(t);
    setGuardando(false);
    if (ok) { setEditando(null); setAbierta(null); }
  };

  // ---- Alta y edición ----
  if (editando) return <main>
    <button className="btn ghost mb12" onClick={() => setEditando(null)}>← Volver</button>
    <h2>{t.fila ? "Editar tarea" : "Nueva tarea"}</h2>
    <div className="card">
      <label className="f"><span className="lb">Tarea <em>*</em></span>
        <input type="text" value={t.titulo} onChange={e => setT({ ...t, titulo: e.target.value })}
          placeholder="Mantenimiento preventivo, monitor PAT396" /></label>
      <div className="row">
        <label className="f"><span className="lb">Inicio</span>
          <input type="date" value={t.inicio || ""} onChange={e => setT({ ...t, inicio: e.target.value })} /></label>
        <label className="f"><span className="lb">Fin</span>
          <input type="date" value={t.fin || ""} onChange={e => setT({ ...t, fin: e.target.value })} /></label>
      </div>
      <label className="f"><span className="lb">Ubicación</span>
        <input type="text" value={t.ubicacion || ""} onChange={e => setT({ ...t, ubicacion: e.target.value })}
          placeholder="Hospital, área" /></label>
      <div className="f"><span className="lb">Prioridad</span>
        <div className="chips">{PRIORIDADES.map(p =>
          <button key={p.k} type="button" className={"chip" + (p.k === "alta" ? " neg" : "")}
            aria-pressed={t.prioridad === p.k} onClick={() => setT({ ...t, prioridad: p.k })}>{p.n}</button>)}
        </div></div>
      <label className="f"><span className="lb">Asignar a</span>
        <select value={t.asignado || ""} onChange={e => setT({ ...t, asignado: e.target.value })}>
          <option value="">Sin asignar</option>
          {ingenieros.map(i => <option key={i} value={i}>{i}</option>)}
        </select></label>
      <label className="f"><span className="lb">Observaciones</span>
        <textarea value={t.observaciones || ""} onChange={e => setT({ ...t, observaciones: e.target.value })} /></label>
      <button className="btn primary block" disabled={!(t.titulo || "").trim() || guardando} onClick={aplicar}>
        {guardando ? <span className="spin" /> : "Guardar tarea"}</button>
    </div>
  </main>;

  // ---- Ficha ----
  if (abierta) {
    const col = COLUMNAS.find(c => c.k === abierta.estado);
    const puedeMover = !esVisualizador && (esAdmin || norm(abierta.asignado) === norm(yo));
    return <main>
      <button className="btn ghost mb12" onClick={() => setAbierta(null)}>← Tablero</button>
      <h2>{rotulo(abierta)}</h2>
      <p className="lead">{(PRIORIDADES.find(p => p.k === abierta.prioridad) || {}).n} · {col ? col.n : abierta.estado}</p>
      <div className="card"><div className="kv">
        <div><b>Inicio:</b> {abierta.inicio || "—"}</div>
        <div><b>Fin:</b> {abierta.fin || "—"}</div>
        <div><b>Ubicación:</b> {abierta.ubicacion || "—"}</div>
        <div><b>Asignada a:</b> {abierta.asignado || "sin asignar"}</div>
        {esAdmin && <div><b>Asignó:</b> {abierta.asignadoPor || "—"}</div>}
        {abierta.observaciones && <div className="mt8"><b>Observaciones:</b><br />{abierta.observaciones}</div>}
      </div></div>

      {abierta.bitacora && <>
        <h2 className="mt18">Bitácora</h2>
        <div className="card"><div className="kv pre">{abierta.bitacora}</div></div>
      </>}

      {puedeMover && <>
        <h2 className="mt18">Mover a</h2>
        <div className="chips mb14">
          {COLUMNAS.map(c => <button key={c.k} type="button"
            className={"chip" + (c.k === "con_observacion" ? " neg" : "")}
            aria-pressed={abierta.estado === c.k}
            onClick={() => {
              // Con observación exige explicar por qué la tarea no se completó
              if (c.k === "con_observacion") { setComentario(""); setObservando(true); return; }
              mover(abierta, c.k); setAbierta({ ...abierta, estado: c.k });
            }}>{c.n}</button>)}
        </div>

        {observando && <div className="card">
          <label className="f"><span className="lb">Observación <em>*</em></span>
            <textarea value={comentario} onChange={e => setComentario(e.target.value)} autoFocus
              placeholder="Por qué no se pudo completar: falta de refacción, equipo en uso, acceso restringido…" /></label>
          <div className="actions">
            <button className="btn ghost" onClick={() => setObservando(false)}>Cancelar</button>
            <button className="btn primary" disabled={!comentario.trim()}
              onClick={() => {
                mover(abierta, "con_observacion", comentario.trim());
                setAbierta({ ...abierta, estado: "con_observacion" });
                setObservando(false); setComentario("");
              }}>Guardar observación</button>
          </div>
        </div>}
      </>}
      {!puedeMover && <div className="note">
        {esVisualizador ? "Su perfil es de solo consulta." : "Esta tarea no está asignada a usted."}</div>}

      {esAdmin && <div className="actions">
        <button className="btn" onClick={() => { setT({ ...abierta, asignadoPrevio: abierta.asignado }); setEditando(abierta.id); }}>Editar</button>
        <button className="btn danger" onClick={() => { eliminar(abierta); setAbierta(null); }}>Eliminar</button>
      </div>}
    </main>;
  }

  // Una tarea ocupa todos los días entre su inicio y su fin, no solo los extremos
  const enRango = (x, iso) => {
    const ini = x.inicio || x.fin, fin = x.fin || x.inicio;
    if (!ini) return false;
    return iso >= ini && iso <= fin;
  };

  // ---- Calendario ----
  if (vista === "calendario") {
    const primero = new Date(mes.a, mes.m, 1);
    const dias = new Date(mes.a, mes.m + 1, 0).getDate();
    const desfase = (primero.getDay() + 6) % 7;      // la semana empieza en lunes
    const hoy = hoyISO();
    const celdas = [];
    for (let i = 0; i < desfase; i++) celdas.push(null);
    // Se ordenan igual en todos los días para que cada tarea conserve su renglón
    const ordenadas = [...tareas].sort((a, b) =>
      (a.inicio || "").localeCompare(b.inicio || "") || String(a.id).localeCompare(String(b.id)));
    for (let d = 1; d <= dias; d++) {
      const iso = mes.a + "-" + String(mes.m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      celdas.push({ d, iso, tareas: ordenadas.filter(x => enRango(x, iso)) });
    }
    const delDia = dia ? ordenadas.filter(x => enRango(x, dia)) : [];

    return <main>
      <h2>Tablero</h2>
      <div className="vistas">
        <button aria-pressed={false}
          onClick={() => setVista(esVisualizador ? "ingeniero" : "tablero")}>
          {esVisualizador ? "Por ingeniero" : "Tablero"}</button>
        <button aria-pressed={true}>Calendario</button>
        {esAdmin && <button aria-pressed={false} onClick={() => setVista("reporte")}>Reporte</button>}
      </div>
      <div className="mescab">
        <button className="btn ghost compacto"
          onClick={() => setMes(m => m.m === 0 ? { a: m.a - 1, m: 11 } : { a: m.a, m: m.m - 1 })}>‹</button>
        <b>{MESES_N[mes.m]} {mes.a}</b>
        <button className="btn ghost compacto"
          onClick={() => setMes(m => m.m === 11 ? { a: m.a + 1, m: 0 } : { a: m.a, m: m.m + 1 })}>›</button>
      </div>
      <div className="cal">
        {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <div className="dn" key={i}>{d}</div>)}
        {celdas.map((c, i) => c
          ? <div key={i} className={"dia" + (c.iso === hoy ? " hoy" : "")} onClick={() => setDia(c.iso === dia ? "" : c.iso)}>
              <span className="n">{c.d}</span>
              {c.tareas.slice(0, 3).map(x => {
                const ini = x.inicio || x.fin, fin = x.fin || x.inicio;
                return <span key={x.id} className={"p " + x.prioridad +
                  (c.iso === ini ? " ini" : "") + (c.iso === fin ? " fin" : "")} />;
              })}
              {c.tareas.length > 3 && <span className="mas">+{c.tareas.length - 3}</span>}
            </div>
          : <div key={i} className="dia vacio" />)}
      </div>

      {dia && <>
        <h2 className="mt18">{dia}</h2>
        {!delDia.length && <div className="empty">Sin tareas ese día.</div>}
        {delDia.map(x => <div className={"tarea " + x.prioridad} key={x.id} onClick={() => setAbierta(x)}>
          <div className="t">{rotulo(x)}</div>
          <div className="d">
            {x.ubicacion || "—"}{x.asignado ? " · " + x.asignado.split(" ")[0] : ""}<br />
            {x.inicio || "?"}{x.fin && x.fin !== x.inicio ? " → " + x.fin : ""}
            {(COLUMNAS.find(c => c.k === x.estado) || {}).n
              ? " · " + (COLUMNAS.find(c => c.k === x.estado) || {}).n : ""}
          </div>
        </div>)}
      </>}
    </main>;
  }

  // ---- Agrupado por ingeniero o por ubicación (perfil de consulta) ----
  if (vista === "ingeniero") {
    const grupos = {};
    tareas.forEach(x => {
      const k = (x.asignado || "").trim() || "Sin asignar";
      (grupos[k] = grupos[k] || []).push(x);
    });
    const nombres = Object.keys(grupos).sort((a, b) => a.localeCompare(b));

    return <main>
      <h2>Tablero</h2>
      <p className="lead">Dónde está asignado cada ingeniero.</p>
      <div className="vistas">
        <button aria-pressed={true}>Por ingeniero</button>
        <button aria-pressed={false} onClick={() => setVista("calendario")}>Calendario</button>
      </div>
      <button className="btn ghost block mb14" onClick={cargar} disabled={cargando}>
        {cargando ? <><span className="spin" /> Consultando…</> : "Actualizar"}</button>

      {error && <div className="note bad">{error}</div>}
      {!cargando && !tareas.length && !error && <div className="empty">No hay actividades en el tablero.</div>}

      {nombres.map(n => <div className="mb18" key={n}>
        <h3 className="subtitulo grupo">
          <span>{n}</span><span className="txt-tenue">{grupos[n].length}</span></h3>
        {grupos[n].map(x => <div className={"tarea " + x.prioridad} key={x.id} onClick={() => setAbierta(x)}>
          <div className="t">{rotulo(x)}</div>
          <div className="d">
            {x.inicio || "sin fecha"}{x.fin && x.fin !== x.inicio ? " → " + x.fin : ""}
            {" · " + ((COLUMNAS.find(c => c.k === x.estado) || {}).n || x.estado)}
          </div>
        </div>)}
      </div>)}
    </main>;
  }

  // ---- Reporte ----
  if (vista === "reporte") {
    const f = filtros;
    const lista = tareas.filter(x => {
      if (f.desde && (x.fin || x.inicio) && (x.fin || x.inicio) < f.desde) return false;
      if (f.hasta && (x.inicio || x.fin) > f.hasta) return false;
      if (f.ingeniero && norm(x.asignado) !== norm(f.ingeniero)) return false;
      if (f.estado && x.estado !== f.estado) return false;
      if (f.prioridad && x.prioridad !== f.prioridad) return false;
      return true;
    });
    const contar = campo => {
      const m = {};
      lista.forEach(x => { const k = x[campo] || "Sin asignar"; m[k] = (m[k] || 0) + 1; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };

    return <main>
      <h2>Reporte del tablero</h2>
      <div className="vistas">
        <button aria-pressed={false} onClick={() => setVista("tablero")}>Tablero</button>
        <button aria-pressed={false} onClick={() => setVista("calendario")}>Calendario</button>
        <button aria-pressed={true}>Reporte</button>
      </div>

      <div className="card tight">
        <div className="row">
          <label className="f mb10"><span className="lb">Desde</span>
            <input type="date" value={f.desde} onChange={e => setFiltros({ ...f, desde: e.target.value })} /></label>
          <label className="f mb10"><span className="lb">Hasta</span>
            <input type="date" value={f.hasta} onChange={e => setFiltros({ ...f, hasta: e.target.value })} /></label>
        </div>
        <select value={f.ingeniero} onChange={e => setFiltros({ ...f, ingeniero: e.target.value })}>
          <option value="">Todos los ingenieros</option>
          {ingenieros.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <div className="row mt10">
          <select value={f.estado} onChange={e => setFiltros({ ...f, estado: e.target.value })}>
            <option value="">Todos los estados</option>
            {COLUMNAS.map(c => <option key={c.k} value={c.k}>{c.n}</option>)}
          </select>
          <select value={f.prioridad} onChange={e => setFiltros({ ...f, prioridad: e.target.value })}>
            <option value="">Toda prioridad</option>
            {PRIORIDADES.map(p => <option key={p.k} value={p.k}>{p.n}</option>)}
          </select>
        </div>
      </div>

      <p className="lead">{lista.length} actividad(es) con estos filtros.</p>

      <div className="card">
        <h3 className="subtitulo">Por estado</h3>
        <div className="kv">{contar("estado").map(([k, n]) =>
          <div key={k}><b>{(COLUMNAS.find(c => c.k === k) || {}).n || k}:</b> {n}</div>)}</div>
        <h3 className="subtitulo sep">Por prioridad</h3>
        <div className="kv">{contar("prioridad").map(([k, n]) =>
          <div key={k}><b>{(PRIORIDADES.find(p => p.k === k) || {}).n || k}:</b> {n}</div>)}</div>
        <h3 className="subtitulo sep">Por ingeniero</h3>
        <div className="kv">{contar("asignado").map(([k, n]) => <div key={k}><b>{k}:</b> {n}</div>)}</div>
      </div>

      <label className="f"><span className="lb">Enviar a (opcional)</span>
        <input type="email" value={correoDestino} onChange={e => setCorreoDestino(e.target.value)}
          placeholder="Deje vacío para usar el correo de su usuario" /></label>

      <button className="btn primary block" disabled={!lista.length || enviandoRep}
        onClick={() => enviarReporte({ ...f, correo: correoDestino.trim() })}>
        {enviandoRep ? <><span className="spin" /> Generando…</> : "Enviar reporte completo en PDF"}</button>
      <p className="lead mt8">Incluye totales, el detalle de cada actividad y su bitácora de observaciones.</p>

      {/* Reporte de ubicaciones: solo quién, dónde y por cuánto tiempo */}
      <div className="card mt6">
        <h3 className="subtitulo">
          Reporte de ubicaciones</h3>
        <p className="lead mb12">
          Dónde está asignado cada ingeniero y por cuántos días, en el periodo de arriba. Sin prioridades ni estados.</p>
        <label className="f"><span className="lb">Enviar a <em>*</em></span>
          <input type="email" value={correoUbic} onChange={e => setCorreoUbic(e.target.value)}
            placeholder="correo@ejemplo.com" /></label>
        <button className="btn block" disabled={!correoUbic.trim() || enviandoUbic}
          onClick={() => enviarUbicaciones({ desde: f.desde, hasta: f.hasta, correo: correoUbic.trim() })}>
          {enviandoUbic ? <><span className="spin" /> Generando…</> : "Enviar reporte de ubicaciones"}</button>
      </div>

      {lista.map(x => <div className={("tarea " + x.prioridad) + " mt8"} key={x.id} onClick={() => setAbierta(x)}>
        <div className="t">{x.titulo}</div>
        <div className="d">{x.inicio || "sin fecha"}{x.fin && x.fin !== x.inicio ? " → " + x.fin : ""}<br />
          {x.asignado || "sin asignar"} · {(COLUMNAS.find(c => c.k === x.estado) || {}).n}</div>
      </div>)}
    </main>;
  }

  // ---- Tablero ----
  return <main>
    <h2>Tablero</h2>
    <p className="lead">{esAdmin ? "Todas las actividades del equipo." : "Actividades asignadas a usted."}</p>
    <div className="vistas">
      <button aria-pressed={true}>Tablero</button>
      <button aria-pressed={false} onClick={() => setVista("calendario")}>Calendario</button>
      {esAdmin && <button aria-pressed={false} onClick={() => setVista("reporte")}>Reporte</button>}
    </div>

    {esAdmin && <button className="btn primary block mb10"
      onClick={() => { setT({ ...vacia }); setEditando("nuevo"); }}>Nueva tarea</button>}
    <button className="btn ghost block mb14" onClick={cargar} disabled={cargando}>
      {cargando ? <><span className="spin" /> Consultando…</> : "Actualizar"}</button>

    {error && <div className="note bad">{error}</div>}
    {!cargando && !tareas.length && !error && <div className="empty">No hay actividades en el tablero.</div>}

    <div className="kanban">
      {COLUMNAS.map(c => {
        const dela = tareas.filter(x => x.estado === c.k);
        return <div className="kcol" key={c.k}>
          <h3>{c.n}<b>{dela.length}</b></h3>
          {!dela.length && <div className="nota-mini">Vacía</div>}
          {dela.map(x => <div className={"tarea " + x.prioridad} key={x.id} onClick={() => setAbierta(x)}>
            <div className="t">{x.titulo}</div>
            <div className="d">
              {x.inicio || "sin fecha"}{x.fin && x.fin !== x.inicio ? " → " + x.fin : ""}<br />
              {x.ubicacion || "sin ubicación"}
              {esAdmin && x.asignado ? <><br />{x.asignado}</> : null}
            </div>
          </div>)}
        </div>;
      })}
    </div>
  </main>;
}

function Usuarios({ usuarios, cargar, cargando, error, guardar, ingenieros, yo }) {
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [u, setU] = useState({ nombre: "", nip: "", rol: "operador", activo: true, correo: "" });
  useEffect(() => { cargar(); }, []);

  const nuevo = () => { setU({ nombre: "", nip: "", rol: "operador", activo: true, correo: "" }); setEditando("nuevo"); };
  const editar = x => { setU({ fila: x.fila, nombre: x.nombre, nip: "", rol: x.rol, activo: x.activo, correo: x.correo || "" }); setEditando(x.fila); };
  const aplicar = async () => {
    setGuardando(true);
    const ok = await guardar(u);
    setGuardando(false);
    if (ok) setEditando(null);
  };

  if (editando) return <main>
    <button className="btn ghost mb12" onClick={() => setEditando(null)}>← Volver</button>
    <h2>{editando === "nuevo" ? "Nuevo usuario" : "Editar usuario"}</h2>
    <p className="lead">{editando === "nuevo"
      ? "El nombre debe coincidir con la lista de ingenieros del formulario para que sus órdenes se registren a su nombre."
      : "Deje el NIP vacío si no quiere cambiarlo."}</p>
    <div className="card">
      {editando === "nuevo"
        ? <label className="f"><span className="lb">Nombre <em>*</em></span>
            <select value={u.nombre} onChange={e => setU({ ...u, nombre: e.target.value })}>
              <option value="">Seleccione de la lista del formulario</option>
              {ingenieros.map(i => <option key={i} value={i}>{i}</option>)}
              <option value="__otro">Otro (escribir a mano)</option>
            </select></label>
        : <label className="f"><span className="lb">Nombre</span>
            <input type="text" value={u.nombre} onChange={e => setU({ ...u, nombre: e.target.value })} /></label>}

      {u.nombre === "__otro" && <label className="f"><span className="lb">Nombre a mano <em>*</em></span>
        <input type="text" value={u.nombreLibre || ""} autoFocus
          onChange={e => setU({ ...u, nombreLibre: e.target.value })} /></label>}

      <label className="f"><span className="lb">NIP de 4 dígitos {editando === "nuevo" && <em>*</em>}</span>
        <input type="text" inputMode="numeric" maxLength={4} value={u.nip}
          onChange={e => setU({ ...u, nip: e.target.value.replace(/\D/g, "") })}
          placeholder={editando === "nuevo" ? "1234" : "Sin cambios"} /></label>

      <label className="f"><span className="lb">Rol</span>
        <select value={u.rol} onChange={e => setU({ ...u, rol: e.target.value })}>
          <option value="operador">Operador · captura sus órdenes</option>
          <option value="visualizador">Visualizador · solo consulta el tablero</option>
          <option value="administrador">Administrador · gestiona todo</option>
        </select></label>

      <label className="f"><span className="lb">Correo (opcional)</span>
        <input type="email" value={u.correo} onChange={e => setU({ ...u, correo: e.target.value })} /></label>

      <div className="chips mb14">
        <button type="button" className="chip" aria-pressed={u.activo} onClick={() => setU({ ...u, activo: true })}>Activo</button>
        <button type="button" className="chip neg" aria-pressed={!u.activo} onClick={() => setU({ ...u, activo: false })}>Dado de baja</button>
      </div>

      <button className="btn primary block" disabled={guardando ||
        (u.nombre === "__otro" ? !(u.nombreLibre || "").trim() : !u.nombre) ||
        (editando === "nuevo" && u.nip.length !== 4) ||
        (u.nip.length > 0 && u.nip.length !== 4)}
        onClick={aplicar}>{guardando ? <span className="spin" /> : "Guardar usuario"}</button>
    </div>
  </main>;

  return <main>
    <h2>Usuarios</h2>
    <p className="lead">Quién puede entrar a la app y con qué permisos.</p>
    <button className="btn primary block mb10" onClick={nuevo}>Nuevo usuario</button>
    <button className="btn ghost block mb14" onClick={cargar} disabled={cargando}>
      {cargando ? <><span className="spin" /> Consultando…</> : "Actualizar"}</button>

    {error && <div className="note bad">{error}</div>}
    {!cargando && !usuarios.length && !error && <div className="empty">No hay usuarios registrados.</div>}

    {usuarios.map(x => <div className={"item" + (x.activo ? "" : " apagado")} key={x.fila}>
      <div className="body clic" onClick={() => editar(x)}>
        <div className="t">{x.nombre}{norm(x.nombre) === norm(yo) ? " (usted)" : ""}</div>
        <div className="s">{x.rol === "administrador" ? "Administrador"
          : x.rol === "visualizador" ? "Visualizador" : "Operador"}
          {x.correo ? " · " + x.correo : ""}<br />
          {x.activo ? "Activo" : "Dado de baja"}{x.tieneNip ? "" : " · sin NIP"}</div>
      </div>
      <span className={"tag " + (x.rol === "administrador" ? "pend" : "")}>
        {x.rol === "administrador" ? "admin" : x.rol === "visualizador" ? "consulta" : "operador"}</span>
    </div>)}
  </main>;
}

function Chat({ ingeniero, sesion, esCoordinador, hilos, cargarHilos, cargando, error,
  hiloAbierto, abrirHilo, cerrarHilo, mensajes, enviarMensaje, enviando, pendientes, noLeidos,
  finalizar, ingenieros, reasignar }) {
  const [confirmando, setConfirmando] = useState(false);
  const [destino, setDestino] = useState("");
  const [texto, setTexto] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [clave, setClave] = useState("");
  const [titulo, setTitulo] = useState("");
  const finRef = useRef(null);

  useEffect(() => { cargarHilos(); }, []);
  useEffect(() => { if (finRef.current) finRef.current.scrollIntoView({ block: "end" }); }, [mensajes.length]);

  const mandar = async () => {
    const t = texto.trim();
    if (!t) return;
    setTexto("");
    await enviarMensaje(t);
  };

  if (nuevo) return <main>
    <button className="btn ghost mb12" onClick={() => setNuevo(false)}>← Volver</button>
    <h2>Nueva conversación</h2>
    <p className="lead">Se identifica por el número de inventario del equipo o por el folio de la orden.</p>
    <div className="card">
      <label className="f"><span className="lb">Inventario o folio <em>*</em></span>
        <input type="text" value={clave} onChange={e => setClave(e.target.value.toUpperCase())}
          placeholder="PAT396 o IAB-24478" /></label>
      <label className="f"><span className="lb">Asunto <em>*</em></span>
        <input type="text" value={titulo} onChange={e => setTitulo(e.target.value)}
          placeholder="Monitor de signos vitales, UCIN" /></label>
      {/* La conversación pertenece a un ingeniero: es lo que decide quién la ve */}
      {esCoordinador && <label className="f"><span className="lb">Dirigida a <em>*</em></span>
        <select value={destino} onChange={e => setDestino(e.target.value)}>
          <option value="">Seleccione ingeniero</option>
          {ingenieros.map(i => <option key={i} value={i}>{i}</option>)}
        </select></label>}
      <button className="btn primary block"
        disabled={!clave.trim() || !titulo.trim() || (esCoordinador && !destino)}
        onClick={() => {
          abrirHilo({ clave: clave.trim(), titulo: titulo.trim(), ingeniero: esCoordinador ? destino : ingeniero });
          setNuevo(false); setClave(""); setTitulo(""); setDestino("");
        }}>Abrir conversación</button>
    </div>
  </main>;

  if (hiloAbierto) return <main>
    <button className="btn ghost mb12" onClick={cerrarHilo}>← Conversaciones</button>
    <h2>{hiloAbierto.titulo || hiloAbierto.clave}</h2>
    <p className="lead">{hiloAbierto.clave}
      {hiloAbierto.ingeniero ? " · dirigida a " + hiloAbierto.ingeniero : " · sin ingeniero asignado"}</p>

    {esCoordinador && <div className="card tight mb14">
      <label className="f mb0"><span className="lb">Ingeniero asignado</span>
        <select value={hiloAbierto.ingeniero || ""} onChange={e => reasignar(hiloAbierto, e.target.value)}>
          <option value="">Sin asignar</option>
          {ingenieros.map(i => <option key={i} value={i}>{i}</option>)}
        </select></label>
    </div>}

    {!mensajes.length && <div className="empty">Todavía no hay mensajes. Escriba el primero.</div>}
    <div className="burbujas">
      {mensajes.map((m, i) => {
        const mio = norm(m.autor) === norm(ingeniero);
        return <div className={"msj" + (mio ? " mio" : "")} key={m.ts + "_" + i}>
          {!mio && <div className="a">{m.autor}</div>}
          <div className="m">{m.mensaje}</div>
          <div className="h">{m.fecha ? new Date(m.fecha).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}{m.enCola ? " · por enviar" : ""}</div>
        </div>;
      })}
      <div ref={finRef} />
    </div>

    <div className="redactar">
      <textarea value={texto} onChange={e => setTexto(e.target.value)} placeholder="Escriba su mensaje" />
      <button className="btn primary holgado" disabled={!texto.trim() || enviando} onClick={mandar}>
        {enviando ? <span className="spin" /> : "Enviar"}</button>
    </div>

    {esCoordinador && (confirmando
      ? <div className="note bad mt14">
          Se van a borrar los {mensajes.length} mensajes de esta conversación para todos. No se puede deshacer.
          <div className="actions mt10">
            <button className="btn ghost" onClick={() => setConfirmando(false)}>Cancelar</button>
            <button className="btn danger" onClick={() => { setConfirmando(false); finalizar(hiloAbierto); }}>
              Sí, finalizar</button>
          </div>
        </div>
      : <button className="btn danger ghost block mt14" onClick={() => setConfirmando(true)}>
          Finalizar conversación</button>)}
  </main>;

  return <main>
    <h2>Chat</h2>
    <p className="lead">{esCoordinador
      ? "Todas las conversaciones del equipo."
      : "Conversaciones sobre sus órdenes y equipos."}</p>

    <button className="btn primary block mb10" onClick={() => setNuevo(true)}>Nueva conversación</button>
    <button className="btn ghost block mb14" onClick={cargarHilos} disabled={cargando}>
      {cargando ? <><span className="spin" /> Consultando…</> : "Actualizar"}</button>

    {!!pendientes && <div className="note">{pendientes} mensaje(s) esperando señal. Se envían solos al reconectar.</div>}
    {error && <div className="note bad">{error}</div>}
    {!cargando && !hilos.length && !error && <div className="empty">No hay conversaciones todavía.</div>}

    {hilos.map(h => <div className="hilo" key={h.clave} onClick={() => abrirHilo(h)}>
      <div className="body">
        <div className="t">{h.titulo || h.clave}</div>
        <div className="u">{h.ultimoAutor ? h.ultimoAutor.split(" ")[0] + ": " : ""}{h.ultimo || ""}</div>
        <div className="u mono11 mt3">
          {h.clave}{esCoordinador
            ? (h.ingeniero ? " · " + h.ingeniero.split(" ").slice(0, 2).join(" ")
              : <span className="txt-alerta"> · sin asignar</span>)
            : ""}</div>
      </div>
      <div className="col-fin">
        <span className="h">{h.ultimaFecha ? new Date(h.ultimaFecha).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : ""}</span>
        {noLeidos[h.clave] > 0 && <span className="tag pend">{noLeidos[h.clave]} nuevo(s)</span>}
      </div>
    </div>)}
  </main>;
}

function Ajustes({ ingeniero, salir, esquema, faltantes, mapa, recargar, estadoProxy, ultimaRevision,
  rol, verUsuarios, cambiarNip, renta }) {
  const formularios = [{ def: FORMULARIOS.trabajo, esquema, mapa, faltantes }].concat(hayRenta() && renta ? [renta] : []);
  const [prueba, setPrueba] = useState(null);
  const [nips, setNips] = useState(null);
  const [cambiando, setCambiando] = useState(false);

  const aplicarNip = async () => {
    setCambiando(true);
    const err = await cambiarNip(nips.actual, nips.nuevo);
    setCambiando(false);
    if (!err) setNips(null); else setNips({ ...nips, err });
  };
  const probar = async () => {
    setPrueba({ ok: null, texto: "Probando…" });
    const url = CONFIG.PROXY_URL + "?action=ping&token=" + encodeURIComponent(CONFIG.TOKEN);
    let principal = false, respaldo = false, det = "";

    try {
      const r = await fetch(url, { redirect: "follow" });
      const cuerpo = (await r.text()).slice(0, 200);
      principal = r.ok && cuerpo.indexOf('"ok":true') > -1;
      det += "Camino principal (fetch) → HTTP " + r.status + "\n" + cuerpo;
    } catch (e) { det += "Camino principal (fetch) → falló: " + e.message; }

    det += "\n\n";
    try { await Api.viaJsonp({ action: "ping" }); respaldo = true; det += "Camino de respaldo (jsonp) → correcto"; }
    catch (e) { det += "Camino de respaldo (jsonp) → no disponible: " + e.message; }

    // El respaldo solo entra si una red bloquea el camino principal: que falle
    // por sí solo no afecta en nada el funcionamiento de la app.
    det += "\n\nURL consultada:\n" + url;
    setPrueba({
      ok: principal || respaldo,
      soloUno: (principal || respaldo) && !(principal && respaldo),
      texto: det
    });
  };
  return <main>
    <h2>Ajustes</h2>
    <p className="lead">Identidad, conexión y correspondencia de campos con el formulario de Jotform.</p>

    <div className="card">
      <div className="kv">
        <div><b>Usuario:</b> {ingeniero}</div>
        <div><b>Rol:</b> {rol === "administrador" ? "Administrador"
          : rol === "visualizador" ? "Visualizador" : "Operador"}</div>
        <div><b>Formulario{hayRenta() ? " de trabajo" : ""}:</b> {CONFIG.FORM_ID}</div>
        {hayRenta() && <div><b>Formulario de renta:</b> {CONFIG.FORM_RENTA_ID}</div>}
        <div><b>Versión de la app:</b> {CONFIG.BUILD || "Rev.01"}</div>
        <div><b>Proxy en uso:</b> …{String(CONFIG.PROXY_URL).slice(-18)}</div>
        <div><b>Estado del proxy:</b> {estadoProxy}</div>
        <div><b>Última revisión:</b> {ultimaRevision ? new Date(ultimaRevision).toLocaleString("es-MX") : "sin revisar"}</div>
        <div><b>Almacenamiento:</b> {Store.modo}</div>
        <div><b>Preguntas leídas:</b> {esquema ? Object.keys(esquema).length : 0}
          {hayRenta() && renta ? " · renta " + (renta.esquema ? Object.keys(renta.esquema).length : 0) : ""}</div>
      </div>
      <div className="actions mt12">
        <button className="btn" onClick={recargar}>Releer formulario</button>
        <button className="btn ghost" onClick={salir}>Cerrar sesión</button>
      </div>
      {rol === "administrador" && <button className="btn primary block mt10"
        onClick={verUsuarios}>Gestionar usuarios</button>}

      {nips
        ? <div className="separado">
            <label className="f"><span className="lb">NIP actual</span>
              <input type="password" inputMode="numeric" maxLength={4} className="nip" value={nips.actual}
                onChange={e => setNips({ ...nips, actual: e.target.value.replace(/\D/g, ""), err: "" })} /></label>
            <label className="f"><span className="lb">NIP nuevo</span>
              <input type="password" inputMode="numeric" maxLength={4} className="nip" value={nips.nuevo}
                onChange={e => setNips({ ...nips, nuevo: e.target.value.replace(/\D/g, ""), err: "" })} /></label>
            <label className="f"><span className="lb">Repita el NIP nuevo</span>
              <input type="password" inputMode="numeric" maxLength={4} className="nip" value={nips.repetir}
                onChange={e => setNips({ ...nips, repetir: e.target.value.replace(/\D/g, ""), err: "" })} /></label>
            {nips.err && <div className="note bad">{nips.err}</div>}
            {nips.nuevo && nips.repetir && nips.nuevo !== nips.repetir &&
              <div className="note bad">Los dos NIP nuevos no coinciden.</div>}
            <div className="actions">
              <button className="btn ghost" onClick={() => setNips(null)}>Cancelar</button>
              <button className="btn primary" disabled={cambiando ||
                nips.actual.length !== 4 || nips.nuevo.length !== 4 || nips.nuevo !== nips.repetir}
                onClick={aplicarNip}>{cambiando ? <span className="spin" /> : "Cambiar NIP"}</button>
            </div>
          </div>
        : <button className="btn ghost block mt10"
            onClick={() => setNips({ actual: "", nuevo: "", repetir: "", err: "" })}>Cambiar mi NIP</button>}
      <button className="btn ghost block mt10" onClick={probar}>Probar conexión</button>
      {prueba && prueba.ok !== null && <div className={("note" + (prueba.ok ? "" : " bad")) + " mt10"}>
        {prueba.ok
          ? (prueba.soloUno
            ? "Conexión correcta. Uno de los dos caminos no está disponible, pero la app funciona con el otro."
            : "Conexión correcta por los dos caminos.")
          : "Sin conexión con el proxy. Revise la URL y el token."}
      </div>}
      {prueba && <pre className="diagnostico">{prueba.texto}</pre>}
    </div>

    {formularios.map(F => <div key={F.def.id}>
      <h2 className="mt20">Correspondencia de campos{formularios.length > 1 ? " · " + F.def.nombre : ""}</h2>
      {!F.esquema
        ? <div className="note bad">Todavía no se ha leído este formulario. Toque "Releer formulario" con señal.</div>
        : F.faltantes.length
          ? <div className="note bad">{F.faltantes.length} campo(s) sin localizar en el formulario: {F.faltantes.map(f => f.et).join(", ")}. Esos datos no se envían.</div>
          : <div className="note">Los {Object.keys(F.mapa).length} campos de la app quedaron enlazados al formulario.</div>}
      <div className="card"><div className="kv">
        {F.def.todos.map(c => {
          const m = F.mapa[c.k];
          return <div key={c.k}><b>{c.et}</b> → {m ? `qid ${m.qid} · ${m.type.replace("control_", "")}` : <span className="txt-alerta">sin enlazar</span>}</div>;
        })}
      </div></div>
    </div>)}
  </main>;
}

/* ==========================================================
   7. APP
   ========================================================== */
function App() {
  const [listo, setListo] = useState(false);
  const [ingeniero, setIngeniero] = useState("");
  const [tab, setTab] = useState("tablero");
  const [editando, setEditando] = useState(null);
  const [borradores, setBorradores] = useState([]);
  const [cola, setCola] = useState([]);
  const [enviados, setEnviados] = useState([]);
  const [esquema, setEsquema] = useState(null);
  const [esquemaRenta, setEsquemaRenta] = useState(null);
  const [estadoProxy, setEstadoProxy] = useState("sin verificar");
  const [online, setOnline] = useState(navigator.onLine);
  const [enviando, setEnviando] = useState(false);
  const [cargandoEnvios, setCargandoEnvios] = useState(false);
  const [errEnvios, setErrEnvios] = useState("");
  const [toast, setToast] = useState(null);
  const [ultimaRevision, setUltimaRevision] = useState(0);
  const [avisos, setAvisos] = useState([]);
  const [cargandoAvisos, setCargandoAvisos] = useState(false);
  const [errAvisos, setErrAvisos] = useState("");
  const [avisosVistos, setAvisosVistos] = useState(0);
  const [sesion, setSesion] = useState("");
  const [rol, setRol] = useState("operador");
  const [usuarios, setUsuarios] = useState([]);
  const [usuariosAdmin, setUsuariosAdmin] = useState([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(false);
  const [errUsuarios, setErrUsuarios] = useState("");
  const [errUsuariosPub, setErrUsuariosPub] = useState("");
  const [tareas, setTareas] = useState([]);
  const [cargandoTareas, setCargandoTareas] = useState(false);
  const [errTareas, setErrTareas] = useState("");
  const [enviandoRep, setEnviandoRep] = useState(false);
  const [enviandoUbic, setEnviandoUbic] = useState(false);
  const [versionNueva, setVersionNueva] = useState(null);
  const [verTodos, setVerTodos] = useState(false);
  const [hilos, setHilos] = useState([]);
  const [hiloAbierto, setHiloAbierto] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [cargandoChat, setCargandoChat] = useState(false);
  const [errChat, setErrChat] = useState("");
  const [enviandoMsj, setEnviandoMsj] = useState(false);
  const [colaChat, setColaChat] = useState([]);
  const [leidos, setLeidos] = useState({});

  const { mapa, faltantes } = useMemo(() => esquema ? resolverMapa(esquema) : { mapa: {}, faltantes: TODOS }, [esquema]);
  const renta = useMemo(() => ({ def: FORMULARIOS.renta, esquema: esquemaRenta,
    ...(esquemaRenta ? resolverMapa(esquemaRenta, TODOS_RENTA) : { mapa: {}, faltantes: TODOS_RENTA }) }), [esquemaRenta]);
  // Todo lo que depende del formulario sale de aquí según el tipo de la orden
  const datosForm = useCallback(t => t === "renta" ? renta
    : { def: FORMULARIOS.trabajo, esquema, mapa, faltantes }, [renta, esquema, mapa, faltantes]);

  const avisar = (msg, malo) => { setToast({ msg, malo }); setTimeout(() => setToast(null), 3600); };

  const refrescar = useCallback(async () => {
    const [d, o] = await Promise.all([Store.all("drafts"), Store.all("outbox")]);
    setBorradores(d.sort((a, b) => b.actualizada - a.actualizada));
    setCola(o.sort((a, b) => a.creada - b.creada));
  }, []);

  // El formulario de renta se lee aparte: si falla, la orden de trabajo sigue igual.
  const leerEsquemaRenta = useCallback(async (silencio) => {
    if (!hayRenta()) return;
    try {
      const d = await Api.get(silencio ? { action: "schema", form: "renta" } : { action: "schema", form: "renta", fresco: "1" });
      setEsquemaRenta(d.questions);
      await Store.put("meta", { id: "schema:renta", questions: d.questions, ts: Date.now() });
    } catch (e) {
      const c = await Store.one("meta", "schema:renta");
      if (c) setEsquemaRenta(c.questions);
      if (!silencio) avisar("Formulario de renta: " + e.message, true);
    }
  }, []);

  const leerEsquema = useCallback(async (silencio) => {
    leerEsquemaRenta(silencio);
    try {
      // Al pedirlo a mano se salta la caché del proxy: es lo que se espera de
      // un botón llamado "Releer formulario".
      const d = await Api.get(silencio ? { action: "schema" } : { action: "schema", fresco: "1" });
      setEsquema(d.questions); setEstadoProxy("conectado"); setUltimaRevision(Date.now());
      await Store.put("meta", { id: "schema", questions: d.questions, ts: Date.now() });
      if (!silencio) avisar("Formulario leído: " + Object.keys(d.questions).length + " preguntas");
    } catch (e) {
      setEstadoProxy("sin conexión: " + e.message);
      const c = await Store.one("meta", "schema");
      if (c) setEsquema(c.questions);
      if (!silencio) avisar(e.message, true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Store.init();
      const g = await Store.one("meta", "ingeniero");
      const ses0 = await Store.one("meta", "sesion");
      // Sin sesión vigente no hay identidad: la app siempre pide NIP al entrar.
      if (g && ses0 && ses0.token && Date.now() - ses0.ts < 12 * 3600 * 1000) setIngeniero(g.valor);
      const c = await Store.one("meta", "schema");
      if (c) setEsquema(c.questions);
      const cr = await Store.one("meta", "schema:renta");
      if (cr) setEsquemaRenta(cr.questions);
      const vistos = await Store.one("meta", "avisosVistos");
      if (vistos) setAvisosVistos(vistos.ts || 0);
      const ses = await Store.one("meta", "sesion");
      // La sesión dura 12 horas en el servidor. Al vencer se pide el NIP otra vez.
      if (ses && ses.token && Date.now() - ses.ts < 12 * 3600 * 1000) {
        setSesion(ses.token); setRol(ses.rol || "operador");
      } else if (ses) {
        await Store.del("meta", "sesion");
        await Store.del("meta", "ingeniero");
      }
      const up = await Store.one("meta", "usuariosPublicos");
      if (up) setUsuarios(up.items || []);
      const l = await Store.one("meta", "leidos");
      if (l) setLeidos(l.mapa || {});
      setColaChat(await Store.all("chatCola"));
      if (g) {
        const guardados = await Store.one("meta", "avisos:" + g.valor);
        if (guardados) setAvisos(guardados.items || []);
      }
      await refrescar();
      setListo(true);
      // Sin sesión, lo único que hace falta para entrar es la lista de usuarios:
      // se pide sola y el formulario (que tarda más, consulta Jotform) va después,
      // para no competir por la misma conexión de datos móviles.
      if (!ses0 || !ses0.token) cargarUsuariosPublicos().finally(() => leerEsquema(true));
      else { leerEsquema(true); confirmarSesion(ses0.token); }
    })();
    const nueva = e => setVersionNueva(e.detail);
    window.addEventListener("versionNueva", nueva);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on); window.removeEventListener("offline", off);
      window.removeEventListener("versionNueva", nueva);
    };
  }, []);


  /* El rol guardado en el teléfono puede haber cambiado en la hoja. Al abrir se
     pregunta al servidor: si cambió, se actualiza; si la sesión ya no es válida
     (baja, vencimiento), se pide el NIP otra vez. Sin conexión se conserva la
     sesión guardada para no dejar al ingeniero fuera en campo. */
  const confirmarSesion = async token => {
    if (!navigator.onLine) return;
    try {
      const d = await Api.get({ action: "sesion", sesion: token });
      if (!d.sesion) {
        await Store.del("meta", "sesion");
        await Store.del("meta", "ingeniero");
        setSesion(""); setRol("operador"); setIngeniero("");
        cargarUsuariosPublicos();
        avisar("Su sesión terminó. Entre de nuevo con su NIP.", true);
        return;
      }
      setRol(d.sesion.rol);
      const ses = await Store.one("meta", "sesion");
      if (ses) await Store.put("meta", { ...ses, rol: d.sesion.rol });
    } catch (e) { /* sin respuesta se conserva lo guardado */ }
  };

  const cargarUsuariosPublicos = useCallback(async () => {
    setCargandoUsuarios(true); setErrUsuariosPub("");
    try {
      const d = await Api.get({ action: "usuariosPublicos" });
      setUsuarios(d.usuarios || []);
      await Store.put("meta", { id: "usuariosPublicos", items: d.usuarios, ts: Date.now() });
    } catch (e) {
      const c = await Store.one("meta", "usuariosPublicos");
      if (c && c.items && c.items.length) setUsuarios(c.items);
      // El motivo queda a la vista: sin él, la pantalla vacía no explica nada
      else setErrUsuariosPub(e.message || "Sin respuesta");
    }
    setCargandoUsuarios(false);
  }, []);

  // En la pantalla de acceso, si la lista no llegó, se vuelve a pedir sola al
  // recuperar señal o al regresar a la app (antes solo con el botón Reintentar).
  useEffect(() => {
    if (!listo || ingeniero || !errUsuariosPub) return;
    const otraVez = () => { if (navigator.onLine && document.visibilityState === "visible") cargarUsuariosPublicos(); };
    const reloj = setTimeout(otraVez, 8000);
    window.addEventListener("online", otraVez);
    document.addEventListener("visibilitychange", otraVez);
    return () => {
      clearTimeout(reloj);
      window.removeEventListener("online", otraVez);
      document.removeEventListener("visibilitychange", otraVez);
    };
  }, [listo, ingeniero, errUsuariosPub, cargarUsuariosPublicos]);

  const entrar = async (nombre, nip) => {
    try {
      const d = await Api.get({ action: "login", nombre, nip }, { paralelo: false });
      await Store.put("meta", { id: "sesion", token: d.sesion, nombre: d.nombre, rol: d.rol, ts: Date.now() });
      await Store.put("meta", { id: "ingeniero", valor: d.nombre });
      setSesion(d.sesion); setRol(d.rol); setIngeniero(d.nombre);
      return "";
    } catch (e) { return e.message; }
  };

  const cargarTareas = useCallback(async () => {
    setCargandoTareas(true); setErrTareas("");
    try {
      const d = await Api.get({ action: "tareas", sesion });
      setTareas(d.tareas || []);
      await Store.put("meta", { id: "tareas:" + ingeniero, items: d.tareas, ts: Date.now() });
    } catch (e) {
      const c = await Store.one("meta", "tareas:" + ingeniero);
      if (c) { setTareas(c.items || []); setErrTareas("Sin conexión. Se muestra el último tablero guardado."); }
      else setErrTareas("No se pudo consultar el tablero: " + e.message);
    }
    setCargandoTareas(false);
  }, [sesion, ingeniero]);

  const guardarTarea = useCallback(async t => {
    try {
      await Api.post({ action: "tareaGuardar", ...t, sesion });
      await cargarTareas();
      avisar("Tarea guardada");
      return true;
    } catch (e) { avisar("No se pudo guardar: " + e.message, true); return false; }
  }, [sesion, cargarTareas]);

  const moverTarea = useCallback(async (t, estado, comentario) => {
    // Se refleja de inmediato y se confirma con el servidor: en campo la red tarda
    setTareas(prev => prev.map(x => x.id === t.id ? { ...x, estado } : x));
    try {
      await Api.post({ action: "tareaEstado", id: t.id, estado, comentario, sesion });
      cargarTareas();
    } catch (e) { avisar("No se pudo mover: " + e.message, true); cargarTareas(); }
  }, [sesion, cargarTareas]);

  const enviarUbicaciones = useCallback(async f => {
    setEnviandoUbic(true);
    try {
      const d = await Api.post({ action: "reporteUbicaciones", ...f, sesion });
      avisar(d.filas + " asignación(es) enviadas a " + d.correo);
    } catch (e) { avisar("No se pudo enviar: " + e.message, true); }
    setEnviandoUbic(false);
  }, [sesion]);

  const enviarReporte = useCallback(async f => {
    setEnviandoRep(true);
    try {
      const d = await Api.post({ action: "reporteEnviar", ...f, sesion });
      avisar("Reporte enviado a " + (d.destinos || []).join(", "));
    } catch (e) { avisar("No se pudo enviar: " + e.message, true); }
    setEnviandoRep(false);
  }, [sesion]);

  const eliminarTarea = useCallback(async t => {
    try {
      await Api.post({ action: "tareaEliminar", id: t.id, sesion });
      await cargarTareas();
      avisar("Tarea eliminada");
    } catch (e) { avisar("No se pudo eliminar: " + e.message, true); }
  }, [sesion, cargarTareas]);

  const cambiarMiNip = useCallback(async (nipActual, nipNuevo) => {
    try {
      await Api.post({ action: "cambiarNip", nipActual, nipNuevo, sesion });
      avisar("NIP actualizado. Úselo la próxima vez que entre.");
      return "";
    } catch (e) { return e.message; }
  }, [sesion]);

  const cargarUsuariosAdmin = useCallback(async () => {
    setCargandoUsuarios(true); setErrUsuarios("");
    try {
      const d = await Api.get({ action: "usuarios", sesion });
      setUsuariosAdmin(d.usuarios || []);
    } catch (e) { setErrUsuarios(e.message); }
    setCargandoUsuarios(false);
  }, [sesion]);

  const guardarUsuario = useCallback(async datos => {
    try {
      const nombre = datos.nombre === "__otro" ? (datos.nombreLibre || "").trim() : datos.nombre;
      await Api.post({ action: "usuarioGuardar", ...datos, nombre, sesion });
      await cargarUsuariosAdmin();
      await cargarUsuariosPublicos();
      avisar("Usuario guardado");
      return true;
    } catch (e) { avisar("No se pudo guardar: " + e.message, true); return false; }
  }, [sesion, cargarUsuariosAdmin, cargarUsuariosPublicos]);

  const guardarBorrador = async (b, silencio) => {
    await Store.put("drafts", b);
    if (!silencio) { await refrescar(); avisar("Borrador guardado"); }
    else setBorradores(prev => { const o = prev.filter(x => x.id !== b.id); return [b, ...o]; });
  };

  const enviarUno = async o => {
    const t = tipoDe(o), F = datosForm(t);
    const payload = construirPayload(o.valores, F.mapa, F.def.todos);
    // Los borradores creados antes de esta versión no traen folio: se les asigna
    // uno y se guarda, para que un reintento posterior tampoco duplique.
    if (!o.folio) {
      o.folio = "IAB-" + Math.floor(10000 + Math.random() * 90000);
      await Store.put("outbox", o);
    }
    const fotos = await Promise.all((o.valores.fotos || []).map(async f =>
      ({ nombre: f.nombre, dataUrl: f.blob ? await aDataUrl(f.blob) : f.dataUrl })));
    const campoFotos = F.mapa.fotos ? F.mapa.fotos.qid : null;
    const r = await Api.post({ action: "submit", form: t, answers: payload, fotos, campoFotos, cliente: o.id, folio: o.folio,
      asignacionId: o.asignacion ? o.asignacion.id : "", sesion });
    return r;
  };

  const procesarCola = useCallback(async (manual) => {
    if (enviando) return;
    const pend = await Store.all("outbox");
    if (!pend.length) { if (manual) avisar("No hay nada por enviar"); return; }
    const listas = pend.filter(o => datosForm(tipoDe(o)).esquema);
    if (!listas.length) { if (manual) avisar("Primero hay que leer el formulario (Ajustes)", true); return; }
    setEnviando(true);
    let ok = 0, fail = 0, devueltas = 0; const avisos = [];
    // Una orden cuyo formulario aún no se ha leído espera en la cola sin tocarse
    fail += pend.length - listas.length;
    for (const o of listas.sort((a, b) => a.creada - b.creada)) {
      try {
        const r = await enviarUno(o);
        await Store.del("outbox", o.id);
        await Store.put("sent", { id: o.id, submissionID: r.submissionID, valores: o.valores, ts: Date.now(),
          folio: r.folio || o.folio, asignacionId: o.asignacion ? o.asignacion.id : "",
          asignacionMarcada: !!(r.asignacion && r.asignacion.ok) });
        if (r.aviso) avisos.push(r.aviso);
        ok++;
      } catch (e) {
        // Sin señal la orden espera en la cola y se reintenta sola: ahí no hay
        // riesgo de duplicar, porque el envío nunca llegó al servidor.
        // Si el servidor respondió con error, la orden vuelve a borradores y el
        // reenvío queda en manos del ingeniero. Reintentar solo sobre una respuesta
        // ambigua es justo lo que generaba órdenes duplicadas.
        const sinSenal = !navigator.onLine ||
          /sin señal|no se pudo conectar|no pudo cargar el proxy|no respondió a tiempo/i.test(e.message);
        if (sinSenal) {
          await Store.put("outbox", { ...o, intentos: (o.intentos || 0) + 1, error: e.message });
          fail++;
        } else {
          await Store.del("outbox", o.id);
          await Store.put("drafts", { ...o, actualizada: Date.now(), errorEnvio: e.message });
          devueltas++;
        }
      }
    }
    setEnviando(false); await refrescar();
    if (avisos.length) avisar(avisos[0], true);
    else if (devueltas) avisar(devueltas === 1
      ? "La orden regresó a borradores. Revísela y vuelva a enviarla."
      : devueltas + " órdenes regresaron a borradores.", true);
    else if (ok && !fail) avisar(ok === 1 ? "Orden enviada a Jotform" : ok + " órdenes enviadas");
    else if (ok && fail) avisar(`${ok} enviada(s), ${fail} espera(n) señal`, true);
    else if (fail) avisar("Sin señal. La orden espera y se enviará al reconectar.", true);
  }, [enviando, datosForm, refrescar, sesion]);

  useEffect(() => { if (online && listo && (esquema || esquemaRenta)) procesarCola(false); }, [online, listo, esquema, esquemaRenta]);

  // Corrige el nombre guardado si difiere del que espera el formulario
  const ajustarIngeniero = b => {
    if (tipoDe(b) === "renta") return b;      // en renta el nombre es texto libre
    const bueno = nombreDeFormulario(b.valores.ingeniero || ingeniero, mapa);
    if (!bueno || bueno === b.valores.ingeniero) return b;
    return { ...b, valores: { ...b.valores, ingeniero: bueno } };
  };

  const encolar = async b => {
    await Store.put("outbox", { ...b, creada: Date.now(), intentos: 0, error: "", errorEnvio: "" });
    await Store.del("drafts", b.id);
    setEditando(null); setTab("cola"); await refrescar();
    procesarCola(false);
  };

  // El rol viene del servidor; la app solo lo refleja. Un administrador ve todo,
  // un operador solo sus órdenes y sus conversaciones.
  const esCoordinador = rol === "administrador";
  // Perfil de solo consulta: ve el tablero y nada más
  const esVisualizador = rol === "visualizador";

  const cargarHilos = useCallback(async () => {
    setCargandoChat(true); setErrChat("");
    try {
      const d = await Api.get({ action: "chatHilos", ingeniero, sesion });
      setHilos(d.hilos || []);
      await Store.put("meta", { id: "hilos:" + ingeniero, items: d.hilos, ts: Date.now() });
    } catch (e) {
      const c = await Store.one("meta", "hilos:" + ingeniero);
      if (c) { setHilos(c.items || []); setErrChat("Sin conexión. Se muestran las últimas conversaciones guardadas."); }
      else setErrChat("No se pudo consultar el chat: " + e.message);
    }
    setCargandoChat(false);
  }, [ingeniero, sesion]);

  const cargarMensajes = useCallback(async (hilo, silencio) => {
    if (!hilo) return;
    try {
      const d = await Api.get({ action: "chatMensajes", clave: hilo.clave });
      const cola = (await Store.all("chatCola")).filter(m => m.clave === hilo.clave);
      setMensajes([...(d.mensajes || []), ...cola.map(m => ({ ...m, enCola: true }))]);
      await Store.put("meta", { id: "msj:" + hilo.clave, items: d.mensajes, ts: Date.now() });
      const marca = Date.now();
      setLeidos(prev => ({ ...prev, [hilo.clave]: marca }));
      await Store.put("meta", { id: "leidos", mapa: { ...leidos, [hilo.clave]: marca } });
    } catch (e) {
      if (!silencio) {
        const c = await Store.one("meta", "msj:" + hilo.clave);
        if (c) setMensajes(c.items || []);
      }
    }
  }, [leidos]);

  const abrirHilo = useCallback(async hilo => {
    setHiloAbierto(hilo); setMensajes([]);
    await cargarMensajes(hilo);
  }, [cargarMensajes]);

  const procesarColaChat = useCallback(async () => {
    const pend = await Store.all("chatCola");
    if (!pend.length || !navigator.onLine) { setColaChat(pend); return; }
    for (const m of pend.sort((a, b) => a.ts - b.ts)) {
      try {
        await Api.post({ action: "chatEnviar", clave: m.clave, titulo: m.titulo,
          ingeniero: m.ingeniero, autor: m.autor, mensaje: m.mensaje, sesion });
        await Store.del("chatCola", m.id);
      } catch (e) { /* se queda para el siguiente intento */ }
    }
    setColaChat(await Store.all("chatCola"));
  }, [sesion]);

  const enviarMensaje = useCallback(async texto => {
    if (!hiloAbierto) return;
    setEnviandoMsj(true);
    const autor = esCoordinador ? "Proyectos IA Biomédica" : ingeniero;
    const m = { id: uid(), ts: Date.now(), fecha: new Date().toISOString(), clave: hiloAbierto.clave,
      titulo: hiloAbierto.titulo, ingeniero: hiloAbierto.ingeniero || ingeniero, autor, mensaje: texto };
    setMensajes(prev => [...prev, { ...m, enCola: true }]);
    try {
      await Api.post({ action: "chatEnviar", clave: m.clave, titulo: m.titulo,
        ingeniero: m.ingeniero, autor: m.autor, mensaje: m.mensaje, sesion });
      await cargarMensajes(hiloAbierto, true);
      cargarHilos();
    } catch (e) {
      // Sin señal el mensaje espera en el dispositivo, igual que las órdenes
      await Store.put("chatCola", m);
      setColaChat(await Store.all("chatCola"));
      avisar("Sin señal. El mensaje se enviará al reconectar.", true);
    }
    setEnviandoMsj(false);
  }, [hiloAbierto, ingeniero, esCoordinador, sesion, cargarMensajes, cargarHilos]);

  const guardarAviso = useCallback(async datos => {
    try {
      await Api.post({ action: "avisoGuardar", ...datos, sesion });
      await cargarAvisos();
      avisar("Aviso publicado");
      return true;
    } catch (e) { avisar("No se pudo publicar: " + e.message, true); return false; }
  }, [sesion]);

  const reasignarHilo = useCallback(async (hilo, nuevoIngeniero) => {
    try {
      await Api.post({ action: "chatReasignar", clave: hilo.clave, ingeniero: nuevoIngeniero, sesion });
      setHiloAbierto({ ...hilo, ingeniero: nuevoIngeniero });
      await cargarHilos();
      avisar(nuevoIngeniero ? "Conversación asignada a " + nuevoIngeniero.split(" ")[0] : "Conversación sin asignar");
    } catch (e) { avisar("No se pudo reasignar: " + e.message, true); }
  }, [sesion, cargarHilos]);

  const finalizarHilo = useCallback(async hilo => {
    try {
      await Api.post({ action: "chatEliminar", clave: hilo.clave, sesion });
      setHiloAbierto(null); setMensajes([]);
      await cargarHilos();
      avisar("Conversación finalizada");
    } catch (e) { avisar("No se pudo finalizar: " + e.message, true); }
  }, [sesion, cargarHilos]);

  const cargarAvisos = useCallback(async () => {
    setCargandoAvisos(true); setErrAvisos("");
    try {
      const d = await Api.get({ action: "avisos", ingeniero, sesion });
      setAvisos(d.avisos || []);
      await Store.put("meta", { id: "avisos:" + ingeniero, items: d.avisos, ts: Date.now() });
    } catch (e) {
      const c = await Store.one("meta", "avisos:" + ingeniero);
      if (c) { setAvisos(c.items || []); setErrAvisos("Sin conexión. Se muestran los últimos avisos guardados."); }
      else setErrAvisos("No se pudieron consultar los avisos: " + e.message);
    }
    setCargandoAvisos(false);
  }, [ingeniero, sesion]);

  /* Asignaciones de la plataforma → borradores prellenados.
     · Nueva: se crea el borrador y se marca "Borrador" en la plataforma.
     · Cancelada: si el borrador no se ha tocado se quita; si ya tiene captura
       se deja marcado para que el ingeniero decida.
     · Ya enviada desde este teléfono pero sin marcar (sesión vencida, sin
       señal): se marca ahora con su folio. */
  const sincronizando = useRef(false);
  const sincronizarAsignaciones = useCallback(async () => {
    if (!sesion || !ingeniero || rol === "visualizador" || !navigator.onLine || sincronizando.current) return;
    sincronizando.current = true;
    try {
      const d = await Api.get({ action: "misAsignaciones", sesion });
      const lista = d.asignaciones || [];
      const [drafts, outbox, sent] = await Promise.all([Store.all("drafts"), Store.all("outbox"), Store.all("sent")]);
      const desc = await Store.one("meta", "asignacionesDescartadas");
      const descartadas = new Set((desc && desc.ids) || []);
      const marcar = (id, estado, folio) => Api.post({ action: "marcarAsignacion", sesion, id, estado, folio }).catch(() => null);
      let nuevas = 0, quitadas = 0, cambios = false;
      for (const a of lista) {
        const enDraft = drafts.find(b => b.asignacion && b.asignacion.id === a.id);
        const enCola = outbox.find(b => b.asignacion && b.asignacion.id === a.id);
        const enviada = sent.find(x => x.asignacionId === a.id);
        if (a.estado === "Cancelada") {
          if (enDraft && !enDraft.asignacion.cancelada) {
            if (JSON.stringify(enDraft.valores) === enDraft.asignacion.huella) { await Store.del("drafts", enDraft.id); quitadas++; }
            else await Store.put("drafts", { ...enDraft, asignacion: { ...enDraft.asignacion, cancelada: true } });
            cambios = true;
          }
          continue;
        }
        if (enviada) {   // ya se mandó desde aquí: solo falta avisarle a la plataforma
          const r = await marcar(a.id, "Enviada", enviada.folio);
          if (r && r.ok) await Store.put("sent", { ...enviada, asignacionMarcada: true });
          continue;
        }
        if (enCola) continue;
        if (enDraft) { if (a.estado === "Asignada") await marcar(a.id, "Borrador"); continue; }
        if (descartadas.has(a.id)) continue;
        await Store.put("drafts", ordenDesdeAsignacion(a, ingeniero, mapa));
        nuevas++; cambios = true;
        await marcar(a.id, "Borrador");
      }
      if (cambios) await refrescar();
      if (nuevas) avisar(nuevas === 1 ? "Tiene 1 orden asignada nueva en Borradores" : "Tiene " + nuevas + " órdenes asignadas nuevas en Borradores");
      else if (quitadas) avisar(quitadas === 1 ? "Coordinación canceló 1 asignación; se quitó su borrador" : "Coordinación canceló " + quitadas + " asignaciones", true);
    } catch (e) { /* sin respuesta: se intenta en la siguiente revisión */ }
    sincronizando.current = false;
  }, [sesion, ingeniero, rol, mapa, refrescar]);

  useEffect(() => { if (listo && sesion && ingeniero) sincronizarAsignaciones(); }, [listo, sesion, ingeniero]);

  const borrarBorrador = async id => {
    const b = await Store.one("drafts", id);
    if (b && b.asignacion && !b.asignacion.cancelada &&
        !window.confirm("Esta orden se la asignó coordinación. Si la elimina no volverá a aparecer en este teléfono, " +
          "pero la asignación seguirá abierta en la plataforma. ¿Eliminarla?")) return;
    await Store.del("drafts", id);
    if (b && b.asignacion) {
      const desc = await Store.one("meta", "asignacionesDescartadas");
      const ids = ((desc && desc.ids) || []).filter(x => x !== b.asignacion.id).concat(b.asignacion.id).slice(-300);
      await Store.put("meta", { id: "asignacionesDescartadas", ids });
    }
    await refrescar(); avisar("Borrador eliminado");
  };

  // Revisión periódica: relee el formulario cada 10 minutos y al volver a la app.
  // Así el mapeo de campos y el estado del proxy se verifican antes de que un
  // ingeniero intente enviar, y no en el momento de enviar.
  useEffect(() => {
    if (!listo || !ingeniero) return;
    const revisar = () => { if (navigator.onLine) { leerEsquema(true); cargarAvisos(); sincronizarAsignaciones(); } };
    const reloj = setInterval(revisar, 10 * 60 * 1000);
    const alVolver = () => { if (document.visibilityState === "visible") revisar(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", revisar);
    return () => {
      clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", revisar);
    };
  }, [listo, ingeniero, leerEsquema, cargarAvisos, sincronizarAsignaciones]);

  // El chat se consulta solo mientras su pestaña está abierta, cada 25 segundos.
  // Un sondeo permanente agotaría la cuota diaria de Apps Script y dejaría sin
  // servicio el envío de órdenes, que es lo que no puede fallar.
  useEffect(() => {
    if (tab !== "chat" || !listo) return;
    const reloj = setInterval(() => {
      if (!navigator.onLine) return;
      if (hiloAbierto) cargarMensajes(hiloAbierto, true); else cargarHilos();
    }, 25000);
    return () => clearInterval(reloj);
  }, [tab, listo, hiloAbierto, cargarMensajes, cargarHilos]);

  useEffect(() => { if (online && listo) procesarColaChat(); }, [online, listo, procesarColaChat]);

  const cargarEnvios = useCallback(async () => {
    setCargandoEnvios(true); setErrEnvios("");
    try {
      const d = await Api.get({ action: "submissions", ingeniero, limit: 500 });
      setEnviados(d.items || []);
      await Store.put("meta", { id: "envios:" + ingeniero, items: d.items, ts: Date.now() });
    } catch (e) {
      const c = await Store.one("meta", "envios:" + ingeniero);
      if (c) { setEnviados(c.items || []); setErrEnvios("Sin conexión. Mostrando la última consulta guardada."); }
      else setErrEnvios("No se pudo consultar: " + e.message);
    }
    setCargandoEnvios(false);
  }, [ingeniero]);

  if (!listo) return <div className="center"><span className="spin" /></div>;
  if (!ingeniero) return <Identificacion onEntrar={entrar} usuarios={usuarios}
    recargar={cargarUsuariosPublicos} cargando={cargandoUsuarios} errorCarga={errUsuariosPub} />;

  const noLeidosPorHilo = {};
  hilos.forEach(h => {
    const marca = leidos[h.clave] || 0;
    noLeidosPorHilo[h.clave] = (h.ultimoTs && h.ultimoTs > marca) ? 1 : 0;
  });
  const hilosNuevos = Object.values(noLeidosPorHilo).filter(Boolean).length;

  const avisosNuevos = avisos.filter(a => a.fecha && new Date(a.fecha).getTime() > avisosVistos).length;
  const verAvisos = async () => {
    setTab("avisos");
    const ahora = Date.now();
    setAvisosVistos(ahora);
    await Store.put("meta", { id: "avisosVistos", ts: ahora });
  };

  // Una pestaña guardada de una sesión anterior no debe abrirle al visualizador
  // una vista que su perfil no tiene.
  const tabActual = (esVisualizador && tab !== "tablero" && tab !== "ajustes") ? "tablero" : tab;

  // Se compara normalizado: el nombre del usuario y el del formulario pueden
  // diferir en un acento o un espacio, y esa diferencia escondía los borradores.
  const misBorradores = borradores.filter(b =>
    !b.valores.ingeniero || norm(b.valores.ingeniero) === norm(ingeniero));
  const deOtros = borradores.length - misBorradores.length;

  return <>
    <header className="readout">
      <div className="readout-top">
        <img className="mini-firma" src="icon-192.png" alt="" width="26" height="26" />
        <div className="brand">Orden de <span>Trabajo</span></div>
        <div className="who">{ingeniero.split(" ").slice(0, 2).join(" ")}<br />{esCoordinador ? "Coordinación" : "IA Biomédica"}</div>
        <button onClick={() => setTab("ajustes")} aria-label="Ajustes"
          className={"engrane" + (tabActual === "ajustes" ? " activo" : "")}>⚙</button>
      </div>
      <div className="strip">
        <div className="cell"><b className={online ? "on" : "off"}>{online ? "EN LÍNEA" : "SIN SEÑAL"}</b><i>conexión</i></div>
        <div className="cell"><b>{misBorradores.length}</b><i>borradores</i></div>
        <div className="cell"><b className={cola.length ? "wait" : ""}>{cola.length}</b><i>por enviar</i></div>
        <div className="cell">
          <b className={esquema ? "on" : "off"}>
            {esquema ? (ultimaRevision ? new Date(ultimaRevision).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "OK") : "—"}
          </b><i>revisado</i>
        </div>
      </div>
    </header>

    {editando
      ? <Formulario borrador={editando} {...datosForm(tipoDe(editando))}
          guardar={guardarBorrador} enviar={encolar} cancelar={() => { setEditando(null); refrescar(); }} />
      : tabActual === "tablero" ? <Tablero tareas={tareas} cargar={cargarTareas} cargando={cargandoTareas}
          error={errTareas} esAdmin={esCoordinador} yo={ingeniero} guardar={guardarTarea}
          mover={moverTarea} eliminar={eliminarTarea} esVisualizador={esVisualizador}
          enviarReporte={enviarReporte} enviandoRep={enviandoRep}
          enviarUbicaciones={enviarUbicaciones} enviandoUbic={enviandoUbic}
          ingenieros={(mapa.ingeniero && mapa.ingeniero.opciones) || INGENIEROS} />
      : tabActual === "borradores" ? <ListaBorradores borradores={verTodos ? borradores : misBorradores}
          datosForm={datosForm} enviar={encolar} deOtros={deOtros} verTodos={verTodos}
          alternarTodos={() => setVerTodos(v => !v)}
          cola={cola} enviando={enviando} reintentar={() => procesarCola(true)}
          devolver={async id => { const o = await Store.one("outbox", id); await Store.del("outbox", id); if (o) await Store.put("drafts", { ...o, actualizada: Date.now() }); await refrescar(); avisar("Regresó a borradores"); }}
          abrir={b => setEditando(ajustarIngeniero(b))}
          nuevo={t => setEditando(t === "renta" ? nuevaOrden(ingeniero, "renta")
            : nuevaOrden(nombreDeFormulario(ingeniero, mapa)))}
          borrar={borrarBorrador} />
      : tabActual === "envios" ? <MisEnvios ingeniero={ingeniero} enviados={enviados} cargar={cargarEnvios} cargando={cargandoEnvios} error={errEnvios} />
      : tabActual === "avisos" ? <Avisos ingeniero={ingeniero} avisos={avisos} cargar={cargarAvisos}
          cargando={cargandoAvisos} error={errAvisos} esCoordinador={esCoordinador}
          ingenieros={(mapa.ingeniero && mapa.ingeniero.opciones) || INGENIEROS} guardar={guardarAviso} />
      : tabActual === "usuarios" ? <Usuarios usuarios={usuariosAdmin} cargar={cargarUsuariosAdmin}
          cargando={cargandoUsuarios} error={errUsuarios} guardar={guardarUsuario} yo={ingeniero}
          ingenieros={(mapa.ingeniero && mapa.ingeniero.opciones) || INGENIEROS} />
      : tabActual === "chat" ? <Chat ingeniero={ingeniero} sesion={sesion} esCoordinador={esCoordinador}
          hilos={hilos} cargarHilos={cargarHilos} cargando={cargandoChat} error={errChat}
          hiloAbierto={hiloAbierto} abrirHilo={abrirHilo} cerrarHilo={() => { setHiloAbierto(null); cargarHilos(); }}
          mensajes={mensajes} enviarMensaje={enviarMensaje} enviando={enviandoMsj}
          pendientes={colaChat.length} noLeidos={noLeidosPorHilo} finalizar={finalizarHilo}
          ingenieros={(mapa.ingeniero && mapa.ingeniero.opciones) || INGENIEROS} reasignar={reasignarHilo} />
      : <Ajustes ingeniero={ingeniero} esquema={esquema} mapa={mapa} faltantes={faltantes} renta={renta}
          estadoProxy={estadoProxy} ultimaRevision={ultimaRevision} recargar={() => leerEsquema(false)}
          rol={rol} verUsuarios={() => setTab("usuarios")} cambiarNip={cambiarMiNip}
          salir={async () => {
            // Cerrar identidad debe cerrar también la sesión: si no, quien vuelva
            // a entrar dentro de las 12 horas queda como coordinación sin PIN.
            await Store.del("meta", "ingeniero");
            await Store.del("meta", "sesion");
            setSesion(""); setRol("operador"); setIngeniero("");
            setHilos([]); setHiloAbierto(null); setAvisos([]); setUsuariosAdmin([]);
          }} />}

    {toast && <div className={"toast" + (toast.malo ? " bad" : "")}>{toast.msg}</div>}

    {versionNueva && !editando && <div className="actualizar">
      <span className="txt">Hay una versión nueva disponible</span>
      <button onClick={() => {
        // Si hay órdenes a medias se avisa: la recarga no las borra, pero
        // conviene que el ingeniero lo sepa antes de que la pantalla cambie.
        if (versionNueva.waiting) {
          window.__pidioActualizar = true;
          versionNueva.waiting.postMessage("actualizar");
        } else location.reload();
      }}>Actualizar</button>
      <button className="x" onClick={() => setVersionNueva(null)}>Después</button>
    </div>}

    {!editando && <nav className="tabs">
      {(esVisualizador
        ? [["tablero", "▦", "Tablero"]]
        : [["tablero", "▦", "Tablero"], ["borradores", "▤", "Borradores"], ["envios", "✓", "Mis envíos"],
           ["avisos", "⚑", "Avisos"], ["chat", "✉", "Chat"]]).map(([k, ic, et]) =>
        <button key={k} aria-current={tabActual === k ? "page" : undefined}
          onClick={() => k === "avisos" ? verAvisos() : setTab(k)}>
          <span className="ic">{ic}</span>{et}
          {k === "borradores" && cola.length > 0 && <span className="badge">{cola.length}</span>}
          {k === "avisos" && avisosNuevos > 0 && <span className="badge">{avisosNuevos}</span>}
          {k === "chat" && (hilosNuevos + colaChat.length) > 0 && <span className="badge">{hilosNuevos + colaChat.length}</span>}
        </button>)}
    </nav>}
  </>;
}

window.__appLista = true;
ReactDOM.createRoot(document.getElementById("root")).render(<App />);

/* Actualizaciones: cuando hay una versión nueva esperando, se avisa en pantalla
   en lugar de recargar solo. Recargar sin permiso en medio de una captura sería
   peor que quedarse una hora con la versión anterior. */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  // ¿Ya había una versión instalada controlando esta página? En la primera
  // apertura no la hay, y el service worker nuevo toma el control a los pocos
  // segundos: eso disparaba "controllerchange" y la app se RECARGABA SOLA en
  // medio de la primera carga, tirando las peticiones en curso (Rev.42).
  const habiaVersion = !!navigator.serviceWorker.controller;
  window.addEventListener("load", () => setTimeout(async () => {
    try {
      // Se registra unos segundos después de abrir: en la primera visita el
      // service worker descarga de nuevo la app para guardarla, y con datos
      // móviles eso competía con la lista de usuarios.
      const reg = await navigator.serviceWorker.register("sw.js");

      const revisar = () => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent("versionNueva", { detail: reg }));
        }
      };
      revisar();
      reg.addEventListener("updatefound", () => {
        const nuevo = reg.installing;
        if (!nuevo) return;
        nuevo.addEventListener("statechange", () => {
          if (nuevo.state === "installed" && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent("versionNueva", { detail: reg }));
          }
        });
      });

      // Buscar versión nueva al abrir la app y cada media hora
      const buscar = () => { if (navigator.onLine) reg.update().catch(() => {}); };
      setInterval(buscar, 30 * 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") buscar();
      });

      let recargando = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // Primera instalación: nada que recargar. Sí se recarga si el ingeniero
        // tocó "Actualizar" (aunque esta pestaña haya nacido sin versión previa).
        if (recargando || !(habiaVersion || window.__pidioActualizar)) return;
        recargando = true;
        location.reload();
      });
    } catch (e) { /* sin service worker la app sigue funcionando con conexión */ }
  }, 4000));
}
