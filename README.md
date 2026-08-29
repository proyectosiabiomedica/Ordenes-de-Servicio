# Orden de Trabajo · App para ingenieros de servicio

App web instalable (PWA) para capturar el formulario de Jotform
`Orden de Trabajo` (ID **260445478825062**) desde el celular, por pasos, con
borradores locales, cola de envío sin señal y consulta del histórico propio.

**Versión actual: Rev.11** (app) · caché `ot-ia-v11` (service worker).

---

## 1. Archivos

| Archivo | Dónde va |
|---|---|
| `index.html` | Repositorio de GitHub Pages |
| `sw.js` | Repositorio, al mismo nivel que `index.html` |
| `manifest.json` | Repositorio |
| `icon-192.png`, `icon-512.png` | Repositorio |
| `icon-1024.png` | Solo respaldo del logotipo, no hace falta subirlo |
| `Codigo.gs` | Proyecto de Google Apps Script |

---

## 2. Puesta en marcha

### Backend (Apps Script)

1. script.google.com → **Nuevo proyecto** → pegar `Codigo.gs`.
2. Llenar el bloque `CONFIG`:
   - `API_KEY`: llave de la cuenta `proyectosiabiomedica`
     (Jotform → Settings → API → Create New Key, permiso **Full Access**).
   - `TOKEN`: cadena larga aleatoria; debe ir idéntica en `index.html`.
   - Los demás valores ya vienen configurados.
3. Ejecutar `probarConexion`. Autorizar los permisos. Debe listar 57 preguntas.
4. Ejecutar `verHojaEnvios`. Debe encontrar todas las columnas de "Form Responses".
5. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
6. Copiar la URL que termina en `/exec`.

> **Cada vez que se edite `Codigo.gs` hay que hacer Implementar → Administrar
> implementaciones → Editar → Versión: Nueva versión.** Apps Script sirve la
> versión congelada al momento de implementar; sin este paso sigue corriendo el
> código viejo. Es el tropiezo más común.

### Frontend (GitHub Pages)

1. Subir los cinco archivos al repositorio y activar Pages
   (Settings → Pages → rama `main`, carpeta `/root`).
2. En `index.html`, bloque `window.CONFIG`:
   - `PROXY_URL`: la URL `/exec`.
   - `TOKEN`: el mismo del Apps Script.
3. Abrir la URL en el celular → menú del navegador → **Agregar a pantalla de inicio**.

Debe abrirse por `https://`. Con `file://` no funcionan ni el modo sin señal ni la instalación.

---

## 3. Cómo trabaja

- **Identificación**: cada ingeniero elige su nombre una vez; queda en el dispositivo
  y filtra sus borradores y sus envíos.
- **Borradores**: autoguardado en IndexedDB con cada tecla. Sobreviven a cierres,
  reinicios y falta de señal, y se retoman en el paso donde se dejaron.
- **Por enviar**: al terminar, la orden pasa a una cola. Con señal se manda de
  inmediato; sin ella se reintenta sola al reconectar o con *Reintentar ahora*.
  Si falla, puede devolverse a borradores sin perder nada.
- **Mis envíos**: histórico completo del ingeniero leído de la hoja "Form Responses",
  con filtros de año, mes y unidad médica, y búsqueda por equipo, inventario o folio.
  El detalle de cada orden se pide al abrirla.
- **Revisión periódica**: cada 10 minutos, al volver a la app y al recuperar señal,
  se relee el formulario y se revalida la correspondencia de campos. La hora de la
  última revisión aparece en la barra de estado.
- **Ajustes**: correspondencia campo → `qid`, prueba de conexión y datos del proxy.

Los campos se enlazan por el texto de la pregunta contra el esquema que el proxy
descarga de Jotform, no por número fijo. Si se agrega o mueve una pregunta, la app
no se rompe y avisa en Ajustes si algo dejó de encontrarse.

---

## 4. El envío: lo que costó descubrir

El envío **no** usa la API de Jotform. Las submissions creadas por API quedan
registradas pero **no disparan notificaciones, PDF, condiciones ni integraciones**.
Como el flujo manda correo al cliente y al supervisor con el PDF adjunto, el proxy
envía por `https://submit.jotform.com/submit/260445478825062`, igual que el
formulario público.

Requisitos de ese endpoint, todos necesarios:

1. **`simple_spc` debe valer `formID-formID`.** El HTML lo publica sin sufijo, pero
   un script del propio formulario lo reescribe antes de enviar. Con el valor del
   HTML, Jotform responde con un captcha ("Enter the message as it's shown") y
   descarta la orden en silencio, devolviendo HTTP 200.
2. **Cabeceras de navegador**: `Referer`, `Origin` y un `User-Agent` real. Sin ellas
   el POST se atiende pero no se registra.
3. **Seis campos de control**: `submitSource`, `buildDate`, `jsExecutionTracker`,
   `submitDate`, `uploadServerUrl`, `eventObserver`, más `formID` y el honeypot
   `website` vacío.
4. **Llaves repetidas** para casillas (`q20_tipode[]` una vez por opción) y para
   archivos (`q147_cargaDe[]` uno por foto). Numeradas (`[0]`, `[1]`) no sirven.
5. **El folio `q61_idUnico`** lo genera el navegador al abrir el formulario. Como el
   proxy no pasa por ahí, lo genera él con el mismo formato `IAB-#####`.
6. **Cuerpo como Blob.** Sin archivos va urlencoded; con archivos, multipart armado a
   mano. `UrlFetchApp` no acepta un arreglo de bytes: lo convierte a texto y Jotform
   responde 400.

Un HTTP 200 no garantiza nada: el proxy compara el último envío antes y después
para confirmar que la orden quedó registrada.

**`RESPALDO_API: false`.** Si el envío por formulario falla, la orden **no** se manda
por API: se queda en la cola del celular con el motivo a la vista. Es preferible a que
entre a medias y nadie se entere. El código del respaldo sigue en el archivo por si
alguna vez hace falta como plan B temporal.

---

## 5. Detalles del formulario

- **Encabezados duplicados**: "ESTATUS DE SEGUIMIENTO" e "INGENIERO DE SERVICIO:"
  existen como título (`control_head`) y como campo. El buscador excluye los tipos que
  no capturan datos; si no, los datos se escriben en un título y se pierden.
- **El campo de estatus (qid 77) no tiene etiqueta**, así que se enlaza por su nombre
  interno `escribaUna`.
- **Valores de Medición (qid 133)** es el widget *Matrix Dinámica*. Se envía como JSON,
  un arreglo de objetos con los encabezados como llaves:
  `[{"Medicion":"…","Valor Programado":"…","Valor Desplegado":"…","Valor Medido":"…"}]`.
  Los nombres de las columnas se leen de la propiedad `cols` del widget.
- **Teléfono (qid 64)** va en el subcampo `[full]`.
- **Fechas (qid 62 y 63)** son de 24 horas y llevan `[day] [month] [year] [hour] [min] [timeInput]`.
- **La pregunta 1 dice "LIMPIEZA Y DESINFECCI N"** (falta la Ó) en el formulario. Se
  localiza por el prefijo `1.-`, así que funciona igual y tampoco se rompe si se corrige.
- **Los cuatro campos "OTRO:" y las tres "Firma"** se distinguen por orden de aparición.
- **Firmas**: PNG en base64, tinta oscura sobre recuadro claro, fondo transparente.
- **Fotos**: se comprimen en el celular y se adjuntan al campo *Carga de archivo*. Si
  Jotform rechaza el adjunto, van a Drive y sus enlaces se anexan a Observaciones, pero
  la orden entra igual por el camino principal y los correos se disparan.

---

## 6. Hojas de cálculo

| Hoja | Uso |
|---|---|
| `1_Q1wOl…` → *Bitacora OT* | Una fila por envío: fecha, submission ID, fotos, respuestas |
| `1_Q1wOl…` → *Diagnostico OT* | Detalle técnico: campos enviados, ruta, HTTP, motivo de falla |
| `1CdyrKa…` → *Form Responses* | Integración de Jotform. De aquí se lee "Mis envíos" |

Las dos primeras pestañas las crea el script solo. La cuenta que ejecuta el Apps Script
necesita permiso de edición en la primera y de lectura en la segunda.

---

## 7. Diagnóstico

Funciones para ejecutar desde el editor de Apps Script:

| Función | Para qué |
|---|---|
| `probarConexion` | Lista las 57 preguntas con su `qid`, tipo y texto |
| `diagnostico` | Estado de la API Key y respuesta literal de Jotform |
| `probarWebApp` | Llama a la aplicación web desde fuera, como lo haría un celular |
| `probarRutasEnvio` | Cuál de las rutas de envío acepta el formulario |
| `probarEnvioMinimo` | Envío real de prueba, sin archivos. **Dispara los correos del flujo** |
| `verHojaEnvios` | Filas leídas y columnas elegidas de "Form Responses" |
| `verCampoMediciones` | Definición completa del widget Matrix Dinámica |
| `verFormatoMediciones` | Valor crudo de ese campo en envíos reales |
| `verRespuestasCrudas` | Cómo quedaron guardados los campos conflictivos |

En la app, *Ajustes → Probar conexión* prueba los dos caminos de transporte. Que falle
JSONP por sí solo no importa: es el respaldo, y solo entra si una red bloquea el `fetch`.

---

## 8. Al publicar cambios

1. Subir el `sw.js` con el número de caché aumentado (`ot-ia-v11` → `ot-ia-v12`).
2. Reimplementar el Apps Script con **Nueva versión** si se tocó `Codigo.gs`.
3. Si el icono cambió, desinstalar la app del celular y volver a agregarla: Android
   guarda el icono al instalar y no lo actualiza solo.

La primera apertura necesita internet, porque ahí se guarda la app en el teléfono.
Conviene que cada ingeniero la abra una vez con wifi antes de salir a campo.
