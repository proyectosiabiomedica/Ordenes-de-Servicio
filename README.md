# Plataforma de Gestión de Mantenimiento — Ingenieros Asociados

Dashboard web para la gestión y visualización de servicios de mantenimiento de equipo médico, con **identidad institucional de Ingenieros Asociados** (paleta y logotipo) desde la versión 2.8. Consume en tiempo real las órdenes de trabajo capturadas en **Jotform** y volcadas a **Google Sheets**, y las presenta en cuatro niveles: indicadores globales de operación, detalle por unidad hospitalaria (cliente), generación de rutinas de mantenimiento preventivo imprimibles y, desde la versión 2.6, **comunicación y seguimiento de pendientes con cada cliente** —con envío de correo con adjuntos desde la versión 2.7—, con control de acceso y bitácora de quién entra a la información.

---

## 1. Descripción general

| | |
|---|---|
| **Tipo de aplicación** | Página web estática de un solo archivo (`index.html`) |
| **Backend** | Opcional — Web App de Google Apps Script (`Code.gs`) para bitácora de accesos, sincronización de seguimientos y proxy privado de datos |
| **Origen de datos** | Formulario "Orden de Trabajo" en Jotform → Google Sheets (tres pestañas: órdenes, KPIs y catálogo de equipos de calibración) |
| **Dependencias (CDN)** | Tailwind CSS, Chart.js 4.4.1, chartjs-plugin-datalabels 2.2.0, PapaParse 5.4.1 |
| **Requisitos** | Navegador moderno con conexión a internet |

Sin backend configurado, la página funciona exactamente igual que en versiones anteriores: basta con abrir `index.html` en un navegador o alojarlo en cualquier hosting estático (GitHub Pages, Netlify, SharePoint, etc.). El backend de Apps Script agrega las funciones de seguridad y colaboración descritas en la sección 3.

---

## 2. Funcionalidades

### 2.1 Dashboard General (página inicial)

- **KPIs operativos**: Ratio Preventivo, Ratio Correctivo, MTTR promedio, Tasa de Entrega, Tasa de Refacciones y Fallas Críticas, con filtro por mes o vista anual.
- **Oportunidades de venta**: tarjeta clicable que abre el detalle de todas las órdenes cuyo estatus de seguimiento indica "Requiere cotización", con cliente, equipo, ingeniero y motivo.
- **Estatus de equipos**: conteos de equipos en garantía, en contrato, fuera de servicio y a prueba (8 días).
- **Gráficas dinámicas**: carga de trabajo por ingeniero, distribución de tipos de servicio, principales clientes y principales marcas. Todas responden al filtro de mes.

### 2.2 Vista por cliente (barra lateral)

- Barra lateral con todas las unidades hospitalarias detectadas en las órdenes, con **buscador** y diseño colapsable en móvil (botón hamburguesa).
- Cabecera con datos de contacto del cliente (dirección, teléfono y correo se eligen automáticamente tomando el valor más frecuente y completo entre sus órdenes).
- Tarjetas de resumen: total de servicios, conteo de preventivos, conteo de correctivos, ingeniero principal y tipo de servicio más frecuente.

### 2.3 Pestaña Mantenimiento Preventivo / Calibración

- Tabla con: **Orden (ID)**, equipo/marca/modelo, serie/inventario, área, fecha de ejecución y **próximo mantenimiento** calculado.
- Badge rojo **"VENCIDO"** cuando la fecha del próximo mantenimiento ya pasó.
- Ordenamiento automático por próximo mantenimiento (los más urgentes primero).
- **Tres filtros combinables**: búsqueda de texto libre (equipo, serie, orden, área…), mes de ejecución (solo meses con datos) y mes de próximo mantenimiento.
- Contador de registros filtrados, **exportación a CSV** e impresión de la tabla.

### 2.4 Generador de Rutinas de Mantenimiento

Documento imprimible por equipo con folio trazable al ID de la orden:

1. **I. Datos de la Unidad Hospitalaria** — cliente, dirección, teléfono.
2. **II. Datos del Equipo** — equipo, área, marca, modelo, serie, inventario, ingeniero y próximo mantenimiento.
3. **III. Condiciones Ambientales del Servicio** — temperatura ambiente (°C) y humedad relativa (%). **Desde la v3.0 se toman de la propia captura del ingeniero**: son las dos primeras entradas de la tabla de mediciones de la orden (ver 4.5). Siguen siendo editables en pantalla por si hubo un error de dedo en campo, y una nota en pantalla —que no se imprime— indica de qué capturas se tomaron.
4. **IV. Datos del Equipo de Calibración / Patrón** — **solo la tabla del catálogo** de equipos patrón utilizados en ese servicio: nombre, marca, modelo, serie, **número de certificado** y **vigencia de la calibración** (más laboratorio, si el catálogo lo registra). Desde la v3.0 **ya no se imprime el texto que el formulario capturó** con el nombre del equipo usado: el dato válido para el documento es el del catálogo. No hay límite de equipos: si el servicio se levantó con cuatro analizadores, se listan los cuatro (ver 4.4). Si ningún registro del catálogo coincide, la sección imprime únicamente un aviso pidiendo verificar el nombre en la hoja.
5. **V. Check-List de Actividades** — 8 actividades estándar con opciones Aprobado / Rechazado / N/A (sin pre-llenar).
6. **VI. Análisis de Valores de Medición** — tabla **editable en pantalla** Parámetro / **Rango estándar de operación** / Programado / Desplegado / Medido / **Error (%)** (tolerancia por parámetro, resaltada en rojo al salirse del criterio) y, desde la versión 2.8, **una gráfica por parámetro** en lugar de una sola gráfica combinada:

   - **Agrupación por parámetro, no por renglón.** Si la orden trae tres mediciones de `SPO2(%)` a distintos valores programados, las tres son puntos de la **misma** gráfica (mediciones 1, 2 y 3). Los valores compuestos se separan: `PANI 120/80` alimenta dos gráficas distintas, *PANI · Sistólica* y *PANI · Diastólica*. La agrupación ignora acentos y mayúsculas.
   - **Ejes.** Eje X: número de medición. Eje Y izquierdo: valor programado y valor real (medido o desplegado). Eje Y derecho: **porcentaje de error** de cada medición, en barras coloreadas por tolerancia (rojo = fuera de criterio, no por el signo del error).
   - **Referencias visuales.** Banda verde con el intervalo aceptable (programado ± tolerancia) alrededor de cada medición, y líneas punteadas con los límites del rango estándar de operación cuando caen dentro de la vista.
   - **Leyenda impresa** bajo cada gráfica con la tolerancia aplicada, el número de mediciones, el intervalo aceptable (uno solo si todas comparten valor programado; detallado por medición si difieren) y el rango estándar de operación.

   - **Error porcentual (v3.0).** La columna Error expresa la desviación como porcentaje respecto al valor programado:

     ```
     error % = (valor real − valor programado) ÷ valor programado × 100
     ```

     El denominador es el **valor programado** porque es el valor verdadero de referencia: lo que se ajustó en el patrón. El numerador es lo que desplegó o midió el equipo bajo prueba. Se **conserva el signo**, porque en calibración importa la dirección de la desviación; si el procedimiento exige el error absoluto porcentual sin signo, basta poner `ERROR_PORCENTUAL_ABSOLUTO = true` en la configuración del archivo. El **error absoluto** (en las unidades del parámetro) no se pierde: aparece en el renglón de desglose de los valores compuestos y en la información emergente de la tabla y de las gráficas.

     Cuando el valor programado es **0** el porcentaje no está definido (división entre cero). En ese renglón se imprime el error absoluto seguido de `(abs.)`, en vez de dejar la celda vacía o mostrar un porcentaje falso.

     La marca de **fuera de tolerancia** sigue evaluándose contra el criterio de la tabla `TOLERANCIAS_PARAMETRO`, que en varios parámetros es absoluto (±3 mmHg, ±0.3 °C). Es intencional: un error de 5 mmHg sobre 120 es 4.17 %, un número pequeño, y aun así excede el criterio del esfigmomanómetro.
   - **Rango estándar de operación (v3.0).** Columna nueva, tomada del renglón que el ingeniero captura en la orden antes de las mediciones de cada parámetro (ver 4.5). Aparece tanto en la tabla como en la leyenda de cada gráfica, indicando su origen. En parámetros compuestos, cada gráfica muestra el extremo que le corresponde (*Sistólica* 10 – 220, *Diastólica* 30 – 260) además del rango completo capturado. Si un parámetro no trae rango en la orden se usa el de la tabla `RANGOS_OPERACION` y el valor se marca con **`*`**, para que quien revisa distinga el dato de campo del de catálogo.

   Al editar cualquier celda, la columna Error se recalcula y las gráficas se redibujan automáticamente. Si algún valor difiere del registro original de la orden, aparece una **nota al pie de la sección** con un campo editable para escribir el **motivo de la modificación**.
7. **VII. Observaciones** — campo de texto libre editable en pantalla para registrar observaciones acerca del servicio antes de imprimir.
8. **VIII. Autorización** — espacio para firma con la leyenda "AUTORIZO" y campo editable para el nombre del responsable autorizado.
9. **Pie de página en todas las hojas (v3.0)** — cada página impresa lleva al pie, dentro del margen inferior, la leyenda *"Prohibida su reproducción parcial o total sin la autorización de la empresa"*. Sustituye a la leyenda única al final del documento. El **encabezado y el pie del navegador** (título, URL, fecha, número de página) no se pueden desactivar por código: hay que quitar la casilla *"Encabezados y pies de página"* en el diálogo de impresión, y el generador lo recuerda en pantalla junto al botón de imprimir.

**Dos fechas (v2.9).** El encabezado distingue la **fecha de medición** (la que trae la orden de trabajo: cuándo se ejecutó el servicio) de la **fecha de emisión** (el día en que se genera el documento). Antes ambas eran la misma casilla, lo que impedía saber si una rutina se imprimió meses después del servicio.

El botón **Imprimir / Guardar PDF** genera el documento completo (todas las páginas, no solo lo visible), oculta la interfaz y convierte las gráficas a imagen para una impresión nítida. Optimizado también para impresión desde dispositivos móviles.

**Impresión de las gráficas (v2.8.2).** Antes de abrir el diálogo, cada gráfica se convierte a imagen y se espera a que termine de decodificarse; al cerrar, los lienzos se restauran. Si una gráfica no se pudiera convertir, se imprime el lienzo original en vez de dejar un hueco. Las tarjetas se maquetan con `inline-block` (no con CSS Grid, cuya fragmentación entre páginas es poco confiable en Chrome) y la sección V puede partirse entre páginas, manteniendo entera cada tarjeta.

**Márgenes de impresión (v2.8).** El documento sale con **25 mm de margen por lado en todas las páginas** (`@page { margin: 25mm }`). Antes el margen se aplicaba con relleno sobre el cuerpo, por lo que solo la primera y la última página quedaban con margen. Si en el diálogo de impresión aparecen el título y la URL del navegador, desactiva la casilla **"Encabezados y pies de página"**.

### 2.5 Pestaña Mantenimiento Correctivo / Asistencia

- Tabla de correctivos, asistencias biomédicas y entregas con orden, equipo, marca/modelo, serie, tipo y fecha.
- Filtro por mes de ejecución (solo meses con datos) y contador de registros.

### 2.6 Pestaña Comunicación y Seguimiento (nuevo en v2.6)

Cada unidad hospitalaria tiene ahora una tercera pestaña para dar seguimiento puntual a pendientes con el cliente:

- **Canales de contacto**: alta, edición y baja de contactos del cliente (nombre, cargo, tipo WhatsApp / Teléfono / Email / Otro, número o correo, y notas). Cada canal tiene su acción directa: abrir chat de WhatsApp con mensaje de saludo pre-llenado, llamar (`tel:`) o redactar correo (`mailto:`).
- **Seguimientos de pendientes**: registros de trabajo pendiente —seguimiento a correctivos, cotizaciones, entregas o mantenimientos en ejecución— con:
  - Vinculación opcional a una **orden de trabajo real** del cliente (se selecciona de la lista de sus órdenes y se guarda un resumen del equipo).
  - Tipo, **prioridad** (Alta/Media/Baja) y **estatus** (Abierto, En proceso, Esperando refacción, Esperando al cliente, Cotización enviada, Concluido).
  - **Historial de avances**: cada actualización registra fecha, autor (el usuario identificado en la sesión), nuevo estatus y nota. Los concluidos pueden reabrirse.
  - Botón **"Enviar por correo"** (v2.7): abre un editor con destinatarios tomados de los canales de tipo Email de la unidad, asunto y cuerpo ya redactados a partir del seguimiento (orden, equipo, estatus y último avance), **archivos adjuntos** hasta 10 MB y la opción de anexar la evidencia fotográfica de la orden vinculada. Puede enviarse de inmediato o dejarse como **borrador en Gmail** para revisarlo antes. El envío lo ejecuta Apps Script con `GmailApp`, de modo que el correo sale desde la cuenta institucional y queda en su bandeja de Enviados; cada envío se registra en la pestaña *Correos enviados* de la hoja y como avance en el historial del seguimiento. Sin backend configurado, el botón abre el programa de correo del equipo con el texto ya escrito, pero sin adjuntos (`mailto:` no puede llevar archivos).
  - Botón **"Enviar por WhatsApp"**: arma un mensaje con la unidad, la orden, el asunto, el estatus y el último avance, y lo abre en WhatsApp hacia el canal registrado que se elija (o hacia el selector de contactos si no hay canal). Los números mexicanos de 10 dígitos reciben la lada 52 automáticamente.
  - Contador de pendientes abiertos como **badge en la pestaña**, y filtro Abiertos / Todos / Concluidos.
- **Persistencia y colaboración**: los registros se guardan siempre en el navegador (localStorage). Si el backend de Apps Script está configurado, además se sincronizan a Google Sheets mediante una **cola de cambios con reintentos** (funciona sin conexión y sube los cambios al reconectar); un indicador muestra el estado: *Guardado en este equipo*, *N cambios por enviar*, *Sincronizando…* o *Sincronizado*. La fusión entre dispositivos es "última escritura gana" por registro, y las eliminaciones también se propagan.

> **Ruta de crecimiento a mensajería:** hoy el envío por WhatsApp usa enlaces `wa.me` (no requiere aprobaciones ni costo; el ingeniero revisa y envía desde su propio WhatsApp). El siguiente paso natural, cuando se quiera enviar automáticamente o desde un número institucional, es la **API de WhatsApp Business** (Meta Cloud API o un proveedor como Twilio); el modelo de datos de esta pestaña —canal, seguimiento, historial— ya está pensado para conectarse a ese envío desde Apps Script sin rehacer la interfaz.

### 2.7 Seguridad: control de acceso y bitácora (nuevo en v2.6)

- **Identificación al entrar**: puede exigirse que cada persona escriba su nombre (y opcionalmente un **PIN** compartido) antes de ver el panel. La sesión se recuerda en ese navegador el número de días configurado, y puede cerrarse desde el pie del menú lateral ("Salir").
- **Bitácora de accesos en Google Sheets**: cada ingreso, cada **intento de PIN fallido** (con el nombre que se escribió), y las acciones sensibles (ver un cliente, imprimir rutina o tabla, exportar CSV, abrir WhatsApp, crear/editar seguimientos, refrescar datos) se registran en la pestaña *Bitácora de Accesos* con fecha del servidor y del cliente, usuario, detalle, plataforma, pantalla, zona horaria, página de origen y user-agent.
- **Proxy privado de datos (opcional)**: con `ORIGEN_DATOS = 'appsscript'`, la página descarga las hojas a través del Web App con token, lo que permite **dejar de publicar** los CSV en la web y cerrar el acceso público a la hoja.

**Alcance honesto de esta seguridad.** El control de acceso corre en el navegador: sirve para *identificar y disuadir* (nadie entra sin dejar rastro y sin conocer el PIN), pero no equivale a una autenticación de servidor —una persona con conocimientos técnicos y el archivo HTML podría leer el código. La mejora real de fondo es el proxy con token + despublicar los CSV: con eso los datos dejan de estar en una URL pública. Para necesidades mayores (usuarios y contraseñas individuales), el paso siguiente sería servir la página detrás de un login (p. ej. Google Sites restringido, Cloudflare Access o SharePoint con permisos).

---

## 3. Configuración

Las tres constantes de configuración están al inicio del bloque `<script>` de `index.html`:

```javascript
// Formato de fecha del CSV publicado por Google Sheets.
// 'DMY' = día/mes/año (hoja en español) | 'MDY' = mes/día/año (hoja en inglés/US).
const FORMATO_FECHA = 'DMY';

// Excluir del dashboard las órdenes marcadas como prueba
// (detecta "orden de prueba" en observaciones/detalle).
const EXCLUIR_ORDENES_PRUEBA = true;

// Frecuencia de mantenimiento (en meses) por tipo de equipo.
const FRECUENCIA_DEFAULT = 6;
const FRECUENCIAS_MESES = [
    { clave: 'cama',    meses: 12 },
    { clave: 'camilla', meses: 12 },
    { clave: 'mesa',    meses: 12 }
    // Agrega más reglas según los contratos:
    // { clave: 'ventilador', meses: 4 },
];
```

- **`FORMATO_FECHA`**: solo se usa cuando la fecha es ambigua (día y mes ≤ 12). El parser también acepta seriales de Excel/Sheets y formato ISO (AAAA-MM-DD) automáticamente.
- **`FRECUENCIAS_MESES`**: se busca la palabra clave dentro del nombre del equipo (sin distinguir acentos ni mayúsculas). La primera regla que coincida define los meses; si ninguna coincide se usa `FRECUENCIA_DEFAULT`.

### Configuración v2.8: identidad, exclusión de registros y rangos

**Colores institucionales.** La paleta se toma del logotipo (`LOGO_mini.png`): **#005DA1** azul institucional, **#ABE1F5** celeste y blanco. Está declarada en dos lugares de `index.html`:

```javascript
// En tailwind.config (encabezado del archivo)
brand: {
    50:  '#F0F9FE', 100: '#DBF0FB', 200: '#ABE1F5', 300: '#7CCAEB',
    400: '#3E9FD1', 500: '#0E77B8', 600: '#005DA1', 700: '#004E88',
    800: '#003D6B', 900: '#002C4D', 950: '#001A2E'
}
```

```css
/* En el bloque <style> */
:root {
    --ia-azul:          #005DA1;
    --ia-azul-medio:    #004E88;
    --ia-azul-oscuro:   #003D6B;
    --ia-azul-profundo: #002C4D;   /* fondo de la barra lateral */
    --ia-celeste:       #ABE1F5;
}
```

El isotipo va **embebido en base64** (funciona sin conexión) en tres lugares: favicon, encabezado de la barra lateral y pantalla de acceso. El logotipo horizontal completo sigue en el encabezado de la rutina impresa. Para cambiar el logotipo, sustituye las cadenas base64 correspondientes.

**Columna "Indicador de Prueba".** En la hoja de órdenes (`Form responses`), una **"X"** en esa columna saca por completo el registro del sistema: no entra a los KPIs del dashboard, ni a las gráficas, ni a las tablas de preventivos y correctivos, ni a oportunidades de venta, ni a la barra lateral de clientes, ni al generador de rutinas. El descarte ocurre al leer la hoja, antes de procesar la fila.

```javascript
const COLUMNA_EXCLUSION = 'Indicador de Prueba';
const CANDIDATOS_COLUMNA_EXCLUSION = [
    'indicador de prueba', 'indicador prueba', 'orden de prueba',
    'excluir', 'no considerar', 'omitir', 'descartar', 'ignorar',
    'anulada', 'anulado', 'cancelada', 'cancelado'
];
const MARCAS_EXCLUSION = ['x', 'xx', 'si', 'sí', 'true', 'verdadero', '1',
                          'prueba', 'excluir', 'omitir'];
```

Detalles de comportamiento:

- La comparación ignora acentos, mayúsculas y espacios: `X`, `x` y `"x "` marcan igual.
- **La celda vacía nunca excluye**, y un valor como `no` tampoco (solo marcan valores afirmativos).
- El encabezado se detecta aunque lleve dos puntos al final (`Indicador de Prueba:`, como suele exportar Jotform).
- Si el nombre declarado no existe en la hoja, se intenta autodetectar con la lista de candidatos y **se avisa en la consola del navegador**; el filtro nunca falla en silencio.
- Cuando se descarta al menos un registro, el sello de hora lo indica: *"Datos actualizados: … · N orden(es) de prueba omitida(s)"*.
- Este filtro es independiente de `EXCLUIR_ORDENES_PRUEBA`, que detecta la frase "orden de prueba" dentro de observaciones o detalle. Ambos pueden convivir.

**Rangos estándar de operación.** Alimentan la leyenda de cada gráfica de la sección V (ver 4.3):

```javascript
const RANGOS_OPERACION = [
    { clave: 'spo2',        min: 70, max: 100, unidad: '%'   },
    { clave: 'temperatura', min: 25, max: 45,  unidad: '°C'  },
    { clave: 'energia',     min: 1,  max: 360, unidad: 'J'   }
    // …
];
```

---

### Configuración v2.6: seguridad y backend

En el mismo bloque `<script>` de `index.html`:

```javascript
// URL del Web App de Apps Script (termina en /exec). Vacío = sin backend.
const URL_APPS_SCRIPT = '';

// Debe coincidir con TOKEN en Code.gs.
const TOKEN_API = '';

// 'csv' = CSV publicados (comportamiento original)
// 'appsscript' = descarga vía Code.gs con token (permite despublicar los CSV)
const ORIGEN_DATOS = 'csv';

// El control de acceso se activa cuando hay PIN definido o hay backend.
// pin: ''      → solo pide nombre (identificación) y lo registra.
// pin: '1234'  → además exige PIN; los intentos fallidos quedan en bitácora.
const CONTROL_ACCESO = { habilitado: true, pin: '', diasSesion: 30 };
```

**Pasos para activar el backend (una sola vez, ~10 minutos):**

1. Abre la hoja de cálculo de Google (la de las órdenes, o una nueva dedicada) → **Extensiones → Apps Script**.
2. Pega el contenido completo de `Code.gs`, cambia `TOKEN` por una cadena larga y, si usarás el proxy de datos, ajusta `HOJA_DASHBOARD` y `HOJA_CORPUS` a los nombres reales de tus pestañas.
3. **Implementar → Nueva implementación → Aplicación web**, con *Ejecutar como: Yo* y *Acceso: Cualquier usuario*. Autoriza los permisos.
4. Copia la URL `…/exec` y pégala en `URL_APPS_SCRIPT` de `index.html`, junto con el mismo token en `TOKEN_API`.
5. Comprueba abriendo en el navegador `…/exec?accion=ping` (debe responder `{"ok":true,…}`).
6. Opcional (recomendado): pon `ORIGEN_DATOS = 'appsscript'`, verifica que el panel siga cargando, y entonces ve a Google Sheets → **Archivo → Compartir → Publicar en la web → Dejar de publicar**. A partir de ahí la hoja ya no es pública.

El script crea solo las pestañas **Bitácora de Accesos**, **Seguimientos** y **Canales** la primera vez que las necesita. La pestaña **`datos equipo de calibracion`** (v2.9) hay que crearla y llenarla a mano; su nombre se configura en `HOJA_PATRONES` de `Code.gs`. Si después modificas `Code.gs`, usa *Administrar implementaciones → editar → Nueva versión* para que la misma URL sirva el código nuevo.

### URLs de origen de datos

También al inicio del script:

```javascript
const csvUrlDashboard = 'https://docs.google.com/spreadsheets/d/e/.../pub?gid=570492353&single=true&output=csv';
const csvUrlCorpus    = 'https://docs.google.com/spreadsheets/d/e/.../pub?gid=680282818&single=true&output=csv';
```

| URL | Contenido |
|---|---|
| `csvUrlDashboard` | Hoja de KPIs mensuales pre-calculados (una fila por mes) |
| `csvUrlCorpus` | Hoja cruda con todas las órdenes de trabajo de Jotform |
| `csvUrlPatrones` | Catálogo de equipos de calibración (v2.9). **Solo se necesita con `ORIGEN_DATOS = 'csv'`**: con el backend activo, Apps Script sirve esa pestaña con `&hoja=patrones`. Si queda vacía, la rutina funciona sin certificado ni vigencia |

Para cambiar de origen: en Google Sheets → **Archivo → Compartir → Publicar en la web** → seleccionar la pestaña → formato CSV → copiar la URL y reemplazarla.

---

## 4. Estructura de datos esperada

### 4.1 Hoja de órdenes (corpus)

Columnas que la aplicación detecta (la búsqueda ignora mayúsculas y acentos, y prioriza coincidencia exacta):

| Dato | Encabezado esperado |
|---|---|
| Folio de la orden | `ID único` |
| Cliente | `UNIDAD:` |
| Contacto | `DOMICILIO:`, `TELÉFONO:`, `EMAIL` |
| Equipo | `EQUIPO:`, `MARCA:`, `MODELO:`, `SERIE:`, `INVENTARIO:`, `ÁREA O UBICACIÓN:` |
| Servicio | `TIPO DE SERVICIO O MANTENIMIENTO`, `FECHA DE INICIO:`, `INGENIERO DE SERVICIO` |
| Seguimiento | `ESTATUS DE SEGUIMIENTO`, `OBSERVACIONES:`, `DETALLE DE FUNCIONALIDAD:` |
| Rutina | `DATOS DEL EQUIPO DE CALIBRACIÓN`, `Valores de Medición` |

**Clasificación por tipo de servicio** (insensible a acentos):

- Pestaña *Preventivos*: contiene "preventivo" o "calibración".
- Pestaña *Correctivos*: contiene "correctivo", "asistencia" o "entrega".

**Formato de mediciones** — para que la sección V de la rutina se genere correctamente, el campo `Valores de Medición` debe seguir el patrón de Jotform:

```
Medicion: SPO2(%), Valor Programado: 85, Valor Desplegado: 85, Valor Medido:
Medicion: Energia, Valor Programado: 30, Valor Desplegado: 30, Valor Medido: 29.5
```

**Valores compuestos (v2.7).** Un valor como `120/80` (PANI) se separa en sus componentes —sistólica y diastólica— y cada uno recibe **su propio error** en la tabla y **su propio punto en la gráfica** (`PANI · Sistólica`, `PANI · Diastólica`). También se admite `120/80/93`, que agrega la presión media. La separación solo ocurre cuando todos los tramos empiezan con número, de modo que `5 L/min` o `N/A` se siguen tratando como valor simple. Las relaciones tipo `1:2` continúan fuera de la gráfica. Si el texto no sigue el patrón `Medicion:`, se genera una tabla simple de lecturas sin gráfica.

**Tolerancias por parámetro (v2.7).** El criterio ya no es un ±10 % fijo. La tabla `TOLERANCIAS_PARAMETRO`, al inicio del bloque de mediciones, declara la tolerancia real de cada tipo de parámetro (absoluta, relativa o mixta) y es la que decide qué se marca en rojo:

| Parámetro (clave) | Tolerancia de arranque |
|---|---|
| `pani`, `nibp`, `presion arterial`, `tension arterial` | ±3 mmHg |
| `spo2` | ±2 % |
| `temperatura` | ±0.3 °C |
| `energia` | ±3 J o ±15 % (el mayor) |
| `frecuencia` | ±5 % |
| cualquier otro | ±10 % |

Estos valores son un punto de partida: **revísalos contra el procedimiento de calibración de cada contrato** antes de usarlos en documentos firmados. En la gráfica, la barra de error se colorea por tolerancia (rojo = fuera de criterio), no por el signo del error.

### 4.4 Catálogo de equipos de calibración (v2.9)

Pestaña **`datos equipo de calibracion`** en la misma hoja de cálculo. Alimenta la sección IV de la rutina con el certificado y la vigencia del analizador utilizado.

| Dato | Encabezados aceptados |
|---|---|
| Nombre del patrón | `Equipo`, `Analizador`, `Equipo patrón`, `Nombre` |
| Identificación | `Marca`, `Modelo`, `Serie` |
| Certificado | `Número de certificado`, `Certificado`, `Folio del certificado` |
| Vigencia | `Vigencia de la calibración`, `Vigencia`, `Fecha de vencimiento`, `Próxima calibración` |
| Laboratorio (opcional) | `Laboratorio`, `Proveedor` |

**Cómo se emparejan los registros.** Se listan **todos** los equipos del catálogo mencionados en el texto que la orden guardó en `DATOS DEL EQUIPO DE CALIBRACIÓN`. Un registro cuenta como mencionado cuando su **nombre**, su **modelo** o su **número de serie** aparecen en ese texto; así, "ProSim 8, Impulse 7000DP y VT650" produce tres renglones, y "Analizador serie 4820015 y serie 3910022" produce dos. Si nada coincide directamente, se recurre una sola vez a la coincidencia por palabras, que exige **al menos dos** palabras significativas y descarta el resultado si dos registros empatan.

> El criterio es deliberadamente estricto: imprimir el certificado de otro equipo es peor que no imprimir ninguno. Un texto como "Fluke" o "Analizador Fluke" no identifica nada y se rechaza; "Multímetro Fluke 87V", ausente del catálogo, tampoco se empareja con otro equipo de la misma marca. Cuando no hay coincidencia, la rutina imprime el texto de la orden con un aviso.

**La vigencia es informativa.** Se imprime la fecha tal como está en el catálogo, en formato `dd/mm/aaaa`, sin distintivo de estado ni advertencias: la valoración de si el patrón estaba vigente queda a criterio de quien revisa el documento.

**Si la pestaña no existe** o no se puede leer, el panel sigue funcionando igual y la rutina imprime solo el texto de la orden con un aviso.

### 4.3 Rangos estándar de operación (v2.8)

La tabla `RANGOS_OPERACION` describe el intervalo dentro del cual el parámetro debe poder trabajar según el equipo. **Es distinto de la tolerancia**: la tolerancia mide el error permitido en un punto de medición, el rango de operación describe el alcance del parámetro. Ambos se imprimen como leyenda bajo cada gráfica.

| Parámetro (clave) | Rango de arranque |
|---|---|
| `frecuencia cardiaca` | 30 – 250 lpm |
| `frecuencia respiratoria` | 5 – 60 rpm |
| `pani`, `nibp`, `presion arterial`, `tension arterial` | 0 – 300 mmHg |
| `spo2` | 70 – 100 % |
| `temperatura` | 25 – 45 °C |
| `energia` | 1 – 360 J |
| `peep` | 0 – 20 cmH₂O |
| `volumen` | 20 – 1 500 mL |
| `flujo` | 0 – 15 L/min |

> **Estos valores son genéricos y deben revisarse contra el manual del fabricante y el procedimiento de calibración de cada contrato antes de firmar documentos.** La clave se busca dentro del nombre del parámetro (sin acentos ni mayúsculas) y manda la primera regla que coincida, por lo que las claves más específicas van primero. Si ningún rango coincide, la leyenda imprime *"No definido en la configuración (verificar manual del equipo)"*.

### 4.2 Hoja de KPIs (dashboard)

Una fila por mes con las columnas (en minúsculas): `mes`, `ratio_preventivo`, `ratio_corectivo` (o `ratio_correctivo`), `mttr`, `tasa_entrega`, `tasa_refacciones`, `fallas_criticas`. Los porcentajes pueden llevar el símbolo `%`.

---

### 4.5 Orden de captura en la tabla de mediciones (v3.0)

El campo **Valores de Medición** de la orden se lee en tres bloques, en el orden en que el ingeniero los captura. Los renglones de condiciones ambientales y de rango **no llevan valores en las columnas**: el dato va escrito dentro del propio nombre del renglón.

**1. Condiciones ambientales** — las dos primeras capturas del servicio:

```
Medicion                              | Programado | Desplegado | Medido
Temperatura ambiental (°C) 16°C       |            |            |
Humedad Relativa ambiental (%) 77%    |            |            |
```

El número se lee del nombre, descartando lo que va entre paréntesis (ahí vive la unidad, no el dato), y alimenta la **sección III**. Ambos campos siguen siendo editables en pantalla.

Para no confundirlas con un parámetro real del equipo —una incubadora o un baño térmico **sí** miden temperatura— solo se extraen cuando el nombre dice *ambiente / ambiental / del sitio / de la sala*, o cuando aparecen entre las **dos primeras** capturas. El número de posiciones revisadas se ajusta en `POSICIONES_AMBIENTE`.

**2. Rango estándar de operación** — un renglón propio, sin valores, **antes** de las mediciones del parámetro al que aplica:

```
Rango estándar de operación ECG 20 BPM-300BPM
ECG (BPM)                             |     30     |     30     |
ECG (BPM)                             |     60     |     60     |
Rango estándar de operación SpO2  1 %O2-100 %O2
Spo2 (%O2)                            |     85     |     85     |
Rango estandar de operacion PANI 10/30 mmHg- 220/260mmHg
PANI (mmHg)                           |   120/80   |   121/80   |
```

- **El renglón funciona como encabezado de sección**: el rango se aplica a todas las mediciones que vienen debajo, hasta el siguiente renglón de rango. Por eso `Rango estándar de operación  6J-200J` —sin nombre de parámetro— cubre correctamente *Energía min*, *Energía* y *Energía max*.
- Si el renglón **sí** nombra el parámetro (ECG, SpO2, PANI), también se registra por nombre, de modo que el emparejamiento funciona aunque las mediciones se escriban con su unidad (`ECG` ↔ `ECG (BPM)`).
- **Nombres con dígitos** (`SpO2`, `EtCO2`, `N2O`) y **unidades con dígitos** (`%O2`) se manejan correctamente: el `2` de `SpO2` no se confunde con el mínimo del rango.
- **Rangos compuestos**: `PANI 10/30 mmHg- 220/260mmHg` se separa por componente, de modo que la gráfica de *Sistólica* usa 10 – 220 y la de *Diastólica* 30 – 260. La tabla imprime el rango completo `10/30 – 220/260 mmHg`.
- Separadores admitidos: `-`, `–`, `—`, `a` y `hasta`. Un mínimo negativo (`-10 a 50 °C`) no se confunde con el separador.
- Solo se hereda el rango en mediciones **comparables** (con valor programado y valor real). Así, un renglón como `Tiempo de carga max energía 200 J (s)` —que se mide en segundos— no arrastra el rango de energía en joules.

El rango aparece en **la columna "Rango estándar de operación" de la tabla** y en **la leyenda de cada gráfica**, indicando si se capturó en la orden o proviene de la tabla `RANGOS_OPERACION` del sistema (en cuyo caso se marca con `*`).

**3. Valores de medición**, con el formato de siempre:

```
Medicion: SPO2(%), Valor Programado: 90, Valor Desplegado: 90, Valor Medido: 88
```

Si una orden solo trae ambientales y rangos, la sección VI lo dice explícitamente en vez de quedarse vacía.

## 4.6 Control de acceso, usuarios y roles (v3.1)

### Cómo se entra

Cada persona escribe **únicamente su PIN**. El nombre no se captura: el servidor lo resuelve a partir del PIN y lo registra en la bitácora. Así nadie puede entrar con el nombre de otra persona, y el ingreso en campo es de un solo dato.

Esto tiene una consecuencia obligatoria: **el PIN es la identidad, así que no puede repetirse**. Si dos personas tuvieran el mismo, la bitácora dejaría de distinguirlas. El alta de usuarios rechaza un PIN que ya esté en uso y también rechaza el que coincida con el código maestro.

Hay dos roles:

| Rol | Qué puede hacer |
|---|---|
| **Usuario** | Todo el panel: dashboard, unidades, rutinas, seguimiento y correo. No ve el apartado de usuarios |
| **Administrador** | Lo anterior, más dar de alta, actualizar, desactivar y eliminar usuarios |

Para entrar como administrador se escribe el **código maestro** en el campo del PIN. Ese código vive únicamente en `Code.gs` (constante `CODIGO_ADMIN`) y **nunca se envía al navegador**; el ingreso se registra con el nombre de `NOMBRE_ADMIN`. Un usuario con rol `admin` en la hoja también entra como administrador con su PIN normal, y en ese caso la bitácora guarda su nombre real, que es preferible para saber quién dio de alta a quién.

**El código maestro debe tener al menos 6 caracteres.** Si tiene menos, el servidor lo ignora por completo y el ingreso falla como si el PIN fuera incorrecto. Desde la v3.2 ese caso queda anotado en la bitácora como `config_invalida` para que el motivo real sea visible.

### Qué protege realmente

Esto es lo importante y conviene tenerlo claro antes de confiar en el mecanismo:

- **Con backend configurado**, el navegador no conoce ningún PIN. Al entrar manda nombre y PIN a Apps Script, y el servidor responde solo si son correctos. La hoja `Usuarios` guarda la **huella SHA-256 con sal** del PIN, no el PIN: quien abra la hoja no puede leerlos. Cada alta o baja se vuelve a verificar en el servidor, de modo que **manipular la página no sirve de nada**: aunque alguien haga visible el apartado de usuarios desde la consola, el servidor rechaza la operación por falta de credencial.
- **Sin backend**, la aplicación cae a un modo local donde los usuarios se guardan en ese navegador. Sirve para probar o para un equipo suelto, pero **no es un control de acceso real**: cualquiera con la consola puede sortearlo. Para uso formal hay que configurar `URL_APPS_SCRIPT`.
- Esconder el botón de usuarios a quien no es administrador es **comodidad, no seguridad**. La seguridad está en la verificación del servidor.

### Puesta en marcha

1. En `Code.gs`, cambiar `CODIGO_ADMIN` por un código propio y `SAL_PIN` por una cadena larga. **La sal se cambia una sola vez, antes de dar de alta al primer usuario**: si se cambia después, todos los PIN existentes dejan de servir.
2. Volver a implementar (*Administrar implementaciones → editar → Nueva versión*).
3. Entrar al panel con cualquier nombre y el código maestro en el campo del PIN.
4. En **Usuarios**, dar de alta a cada ingeniero con su nombre y un PIN **distinto para cada uno**, de preferencia de 6 dígitos.
5. Mientras no exista ningún usuario dado de alta, se sigue aceptando el PIN compartido de `CONTROL_ACCESO.pin`, para no dejar fuera a quien ya lo usaba. En cuanto hay usuarios, ellos mandan.

La credencial de administrador se conserva en `sessionStorage` mientras la pestaña siga abierta, para no pedirla en cada movimiento; al cerrar la pestaña o cerrar sesión se descarta. El servidor la vuelve a verificar en cada operación.

### Bloqueo por intentos fallidos

Como la pantalla de acceso ya no pide nombre, no hay usuario contra el cual contar intentos. El bloqueo se lleva **por dispositivo**: cada navegador genera un identificador propio, guardado en su almacenamiento local, que solo sirve para esto y no identifica a la persona. Seis intentos fallidos desde el mismo equipo bloquean el acceso diez minutos (`MAX_INTENTOS_PIN`, `MINUTOS_BLOQUEO`).

Como red de seguridad hay además un tope global de 30 intentos fallidos en la misma ventana (`MAX_INTENTOS_GLOBAL`). Está deliberadamente alto: un tope global bajo permitiría que una sola persona equivocándose —o alguien malintencionado— dejara fuera a todo el equipo. Es un compromiso entre frenar la prueba masiva de PIN y no convertir el bloqueo en una forma de tumbar la plataforma.

Todos los intentos, exitosos o no, quedan en la bitácora.

**Sobre la longitud del PIN.** Con el ingreso reducido a un solo dato, el PIN es la credencial completa. Cuatro dígitos son diez mil combinaciones: el bloqueo las frena, pero el margen es estrecho. Se recomiendan **6 dígitos**, que multiplican por cien el trabajo de adivinarlos y a los ingenieros les cuesta lo mismo memorizar.

## 4.7 Filtro por año (v3.1)

Las pestañas de **Preventivos** y **Correctivos** tienen un selector de **Año** antes del de mes. Conforme el histórico crece, filtrar solo por mes obliga a revisar todos los años a la vez.

- Los años se toman de la fecha de ejecución de cada orden y se ordenan **del más reciente al más antiguo**.
- El selector de meses se reconstruye con los meses que **existen dentro del año elegido**, para no ofrecer combinaciones vacías. Si el mes que estaba seleccionado no existe en el año nuevo, vuelve a *Todos* en lugar de dejar la tabla vacía sin explicación.
- Las órdenes sin fecha válida se agrupan bajo **Sin fecha** en vez de desaparecer del listado.

## 4.8 Pantalla de carga (v3.3)

Al entrar con el PIN y cada vez que se pulsa **Actualizar**, el panel muestra una pantalla con un anillo de progreso, el contador de 0 a 100 % y el rótulo **"Preparando su información"**.

El porcentaje está atado a etapas reales, no a un reloj:

| Avance | Qué terminó |
|---|---|
| 8 % | Se lanzaron las descargas |
| 30 % | Llegó la hoja de indicadores |
| 55 % | Llegaron las órdenes de trabajo |
| 62 % | Llegó el catálogo de patrones |
| 72 % | Se están organizando las órdenes por unidad |
| 88 % | Se calcularon los próximos mantenimientos |
| 94 % | Se está armando el panel |
| 100 % | Listo; la pantalla se desvanece |

Cada hoja empuja el contador **en cuanto llega**, sin esperar a las demás, así que el número refleja lo que de verdad se completó. Entre una etapa y otra el contador se acerca a su objetivo con una animación suave, pero **nunca rebasa lo ya cumplido**: si una descarga tarda, el número se detiene en su etapa en lugar de fingir avance. Quien mira la pantalla entiende dónde está por el texto inferior, y el arco que gira indica que el proceso sigue vivo.

Con pocas órdenes las últimas etapas pasan muy rápido y casi no se alcanzan a leer; con un histórico grande son las que más tiempo ocupan, que es cuando el aviso sirve.

## 4.9 Instalación como aplicación (v3.4)

La plataforma es una **aplicación web instalable**. Se agrega a la pantalla de inicio o al escritorio y abre como cualquier otra aplicación, sin barra de direcciones.

### Archivos que la componen

| Archivo | Para qué |
|---|---|
| `index.html` | La aplicación completa |
| `manifest.json` | Nombre, icono, color y modo de presentación |
| `sw.js` | *Service worker*: copias locales y funcionamiento sin señal |
| `icono-192.png`, `icono-512.png`, `icono-maskable-512.png`, `apple-touch-icon.png` | Iconos de la aplicación |

**Los siete archivos van sueltos en la raíz del repositorio, sin subcarpetas.** Se eligió así a propósito: subir una carpeta desde la web de GitHub es el paso donde más fácil se pierde algo, y basta con que falte un icono para que el navegador deje de ofrecer la instalación sin decir por qué.

Las rutas son relativas, así que funciona igual en la raíz del dominio o en un subdirectorio de GitHub Pages. Ojo: GitHub Pages **distingue mayúsculas de minúsculas**, así que los nombres deben ir tal cual.

### Cómo se instala

| Dispositivo | Cómo |
|---|---|
| Android / Chrome | Botón **Instalar aplicación** al pie del menú lateral, o menú ⋮ → *Agregar a pantalla principal* |
| iPhone / iPad | Safari → Compartir → *Agregar a inicio* (iOS no ofrece botón dentro de la página) |
| Computadora | Icono de instalar en la barra de direcciones, o el botón del menú lateral |

El botón del menú lateral **solo aparece cuando el navegador acepta la instalación**; si no la ofrece, muestra las instrucciones manuales en lugar de fallar en silencio.

### Qué se guarda en el equipo, y qué no

- **La página y las librerías externas** quedan guardadas tras la primera visita. Este es el beneficio menos obvio y el más útil en la práctica: si la red del hospital bloquea o ralentiza los dominios de Tailwind o Chart.js, la plataforma sigue abriendo con la copia local en lugar de quedarse a medias.
- **La última descarga de hojas** también se guarda. Sin señal, la plataforma abre y muestra esa información con un aviso en pantalla que lo advierte, para que nadie confunda datos viejos con datos del momento.
- **Los envíos nunca se guardan.** Dar de alta un usuario, mandar un correo o registrar un seguimiento siempre exige conexión real: servir una respuesta guardada de esas operaciones haría creer que algo se hizo cuando no ocurrió.

### Actualizaciones

La página **siempre se busca primero en la red**, así que un cambio publicado llega el mismo día. La copia local es el respaldo, no la fuente.

Cuando hay una versión nueva aparece un aviso al pie con el botón **Actualizar**: al pulsarlo se aplica y la página se recarga una sola vez. Si se pospone, el aviso vuelve en la siguiente visita. Al subir una versión nueva conviene **cambiar el número `VERSION` al inicio de `sw.js`**, que es lo que renombra los cachés y descarta los anteriores.

### Si no aparece el icono de instalar

El navegador exige que se cumplan **todos** sus requisitos y, cuando falta uno, no avisa cuál: simplemente no muestra el icono. Para no adivinar, la plataforma trae un **diagnóstico** que los revisa uno por uno y marca en rojo el que falla.

Se abre con el enlace **Diagnóstico de instalación**, al pie del menú lateral, o agregando `?diagnostico=1` a la dirección.

Revisa, en este orden:

1. **Conexión segura.** Abierto como archivo local (`file://`) nunca se ofrece la instalación.
2. **`manifest.json` accesible.** La causa más frecuente: el archivo no se subió junto a `index.html`, o quedó en otra carpeta.
3. **Contenido del manifiesto** e **iconos que de verdad se descargan**. Se exige uno de 192×192 y otro de 512×512.
4. **Service worker activo** y **`sw.js` alcanzable**.
5. Si todo sale en verde y aun así no aparece: recargar una vez, o cerrar y volver a abrir el navegador. Chrome espera además a que el sitio se haya usado un momento antes de ofrecerla.

En **iPhone y iPad no existe el icono de instalar**, hagas lo que hagas: Safari no lo muestra ni avisa a la página. Ahí la instalación es manual, con Compartir → *Agregar a inicio*.

### Requisito

Necesita **HTTPS**, que GitHub Pages ya provee. Abriendo el archivo con doble clic (`file://`) el service worker simplemente no se registra y la plataforma funciona como antes, sin instalación ni copias locales.

## 4.10 Criterio de tolerancia por tipo de equipo (v3.5)

El criterio vigente lo marca **el equipo, no el parámetro**:

| Tipo de equipo | Tolerancia |
|---|---|
| Soporte de vida: desfibrilador, máquina de anestesia, ventilador, vaporizador | **±5 %** |
| Todos los demás | **±10 %** |

El equipo se reconoce por su nombre en la orden, sin acentos y por contención, de modo que *Ventilador volumétrico* o *Máquina de anestesia Fabius* entran igual. La lista se ajusta en `EQUIPOS_SOPORTE_VIDA` y los porcentajes en `TOLERANCIA_SOPORTE_VIDA` y `TOLERANCIA_GENERAL`.

La tabla anterior por parámetro —±3 mmHg en presión, ±2 % en SpO₂, ±0.3 °C en temperatura— **se conserva en el archivo** y puede reactivarse con `CRITERIO_TOLERANCIA = 'parametro'`. Vale la pena saber qué se cede al usar el criterio relativo: **±10 % aprueba una desviación de 8 mmHg sobre 80 mmHg**. Si en algún contrato eso no es aceptable, el modo por parámetro está listo.

La tolerancia aplicada y su origen se imprimen tanto al pie de la tabla de mediciones como en la leyenda de cada gráfica: *"Tolerancia: ±5 % · equipo de soporte de vida"*.

## 4.11 Qué se compara contra qué (v3.5)

Hasta la 3.4 solo se evaluaba cuando existía valor **programado**, así que un renglón con desplegado y medido —muy común en temperatura, presión de vía aérea o flujo, donde no se programa nada— se quedaba sin error y sin gráfica. Ahora hay dos situaciones y en ambas se evalúa:

| Situación | Referencia (valor verdadero) | Valor evaluado |
|---|---|---|
| La orden trae valor programado | **Programado**: es lo que se ajustó en el patrón | Medido y, si no hay, desplegado |
| No hay valor programado | **Medido**: es la lectura del analizador calibrado | **Desplegado** por el equipo bajo prueba |

Si solo existe una de las tres columnas no hay nada que comparar y el renglón se queda sin error, como antes. Esto es lo que mantiene fuera a renglones como *Tiempo de carga max energía 200 J (s)*, que traen una sola lectura suelta.

La información emergente de cada celda dice qué se comparó contra qué: *"Medido contra Programado"* o *"Desplegado contra Medido"*.

## 4.12 Rangos que no se cargaban (v3.5)

Dos causas distintas, ambas resueltas:

**Rangos expresados como relación.** `Rango estándar de operación I:E 4:1-1:9 (relación Inspiración: Espiración)` se imprimía como `1 – 1:9`, sin sentido: el parser buscaba dos números y encontraba los de la relación. Ahora se detecta que es una relación y **se conserva el texto tal cual**, que es lo correcto: una relación no es una magnitud que pueda situarse en un eje, así que se imprime en la tabla y en la leyenda pero no dibuja banda en la gráfica.

**Parámetros sin valor programado.** `P Max` y `P media` quedaban en `—` porque el rango solo se heredaba del encabezado cuando el renglón era comparable, y sin valor programado no lo eran. Al evaluarse ahora desplegado contra medido, heredan correctamente. Nota adicional: el encabezado decía `PAW` y los renglones `P Max (cmH20)`, así que el emparejamiento por nombre tampoco servía; funciona por herencia del encabezado anterior.

**Verificación de unidad.** Heredar del encabezado anterior tiene un riesgo: un renglón de `Temperatura inicial (°C)` colocado después del rango de `Flujo (L/m)` lo heredaría por simple vecindad. Ahora se compara la unidad declarada entre paréntesis y solo se hereda si son compatibles. La comparación unifica el cero y la letra O —`(cmH20)` y `(cmH2O)` son la misma— y admite abreviaturas —`(L/min)` y `(L/m)`— porque los ingenieros usan ambas indistintamente.

## 5. Comportamientos automáticos relevantes

- **Mes de ejecución**: se deriva de `FECHA DE INICIO:`; la hoja no necesita columna "Mes".
- **Redondeo a 2 decimales (v2.9)**: todo número **calculado** por el sistema —errores absolutos y relativos, límites de tolerancia, valores graficados e indicadores del dashboard— se redondea a dos decimales mediante una única función (`redondear`). Se aplica al resultado, nunca a los datos de entrada: los valores capturados en la orden se conservan tal como se registraron.
- **Series e inventarios**: si Sheets los convirtió a notación científica (`9.09033102E8`) se expanden al número completo; se elimina el `.0` residual.
- **Órdenes de prueba**: filas cuyo texto contiene "orden de prueba" se excluyen de todos los conteos y tablas (desactivable con `EXCLUIR_ORDENES_PRUEBA = false`).
- **Indicador de Prueba (v2.8)**: las filas con "X" en la columna `Indicador de Prueba` se descartan **antes** de procesarse, por lo que no aparecen en ningún indicador, gráfica, tabla ni rutina; el contador de omitidas se muestra junto al sello de hora.
- **Datos de contacto del cliente**: al variar entre órdenes, se toma el valor más frecuente (en empate, el más completo).
- **Caché**: cada carga agrega un parámetro de tiempo a las URLs para traer siempre la versión más reciente publicada (Google puede tardar algunos minutos en refrescar la publicación).
- **Carga tolerante a fallos (v2.6)**: si solo falla la hoja de KPIs mensuales, el panel avisa y sigue funcionando con los indicadores en cero; el error total únicamente aparece cuando no se pueden descargar las órdenes.
- **Botón Actualizar y sello de hora (v2.6)**: el encabezado del dashboard muestra "Datos actualizados: …" y permite volver a descargar sin recargar la página; si estabas viendo un cliente, la vista se conserva.
- **"Vencido" respeta el día en curso (v2.6)**: un mantenimiento que vence hoy ya no se marca en rojo; solo los de fechas pasadas.
- **Atajos (v2.6)**: la tecla `Esc` cierra la rutina y el modal de oportunidades (nunca la pantalla de acceso), y hacer clic fuera del modal de oportunidades también lo cierra.

---

## 6. Recomendaciones de operación

1. **No renombrar los campos del formulario de Jotform** sin actualizar la sección 4.1; la detección de columnas depende de esos encabezados.
2. **Evitar campos duplicados en Jotform** (actualmente existen dos "Firma" y varios "OTRO:"): los encabezados repetidos se sobreescriben entre sí al importar el CSV.
3. **Configurar Serie e Inventario como texto** en Jotform/Sheets para evitar la notación científica de origen.
4. **Confidencialidad**: mientras `ORIGEN_DATOS = 'csv'`, la URL del CSV publicado sigue siendo accesible para cualquiera que la conozca. La ruta recomendada es activar el backend de `Code.gs`, cambiar a `ORIGEN_DATOS = 'appsscript'` y **dejar de publicar** los CSV (pasos en la sección 3). Activa también el PIN de `CONTROL_ACCESO` y revisa periódicamente la pestaña *Bitácora de Accesos*.
5. **Frecuencias de mantenimiento**: revisar `FRECUENCIAS_MESES` contra lo pactado en cada contrato; el valor por omisión es semestral.
6. **Token**: trátalo como una contraseña. Si sospechas que se filtró, cámbialo en `Code.gs` y en `index.html` al mismo tiempo.
7. **Seguimientos compartidos**: si varias personas usan la pestaña de Comunicación, configura el backend; sin él, cada navegador guarda sus propios registros y no se comparten.

---

## 7. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| La leyenda del pie sale cortada | El pie sobresalía hacia el margen y el navegador recorta lo que queda fuera del área de página (corregido en la 3.0.1) | Mantener `#piePaginaImpresion` con `bottom: 0`, dentro del área de contenido, y el margen inferior de `@page` en 34 mm |
| Al imprimir aparecen el título y la URL del navegador | Está activa la casilla "Encabezados y pies de página" del diálogo de impresión: no se puede desactivar por código | Quitar esa casilla en el diálogo. El documento ya trae su propio pie con la leyenda legal en todas las hojas |
| Un parámetro real del equipo (incubadora, baño térmico) desapareció de la tabla | Su nombre contiene "temperatura" y quedó entre las dos primeras capturas, por lo que se tomó como condición ambiental | Capturar primero la temperatura y la humedad **ambiente** (con esa palabra en el nombre), o bajar el parámetro del equipo a partir de la tercera posición |
| Un parámetro heredó un rango de otra magnitud | Está debajo del encabezado de otro parámetro y comparten unidad, o ninguno declara unidad entre paréntesis | Capturar su propio renglón de *Rango estándar de operación* antes de sus mediciones |
| El rango sale marcado con `*` | Ese parámetro no trae renglón de rango en la orden; se está usando el de configuración | Capturar el renglón *Rango estándar de operación* antes de las mediciones de ese parámetro, o editar la celda antes de imprimir |
| Un parámetro heredó un rango que no le corresponde | Está debajo de un renglón de rango de otro parámetro y sí es comparable | Capturar su propio renglón de rango antes de sus mediciones |
| Un ingeniero no puede entrar y su nombre sí está dado de alta | Está inactivo, el PIN cambió, o se agotaron los intentos | Revisar su estado en **Usuarios**; si hay bloqueo, esperar 10 minutos. La bitácora registra el motivo de cada intento fallido |
| El código maestro no funciona | No se volvió a implementar el `Code.gs` después de cambiarlo, o tiene menos de 6 caracteres | Implementar → Administrar implementaciones → editar → Nueva versión, y usar un código de al menos 6 caracteres |
| Todos los PIN dejaron de servir de golpe | Se cambió `SAL_PIN` después de dar de alta usuarios | Volver a la sal anterior, o volver a capturar el PIN de cada usuario |
| El apartado de Usuarios no aparece | La sesión no es de administrador | Cerrar sesión y entrar con el código maestro o con un usuario de rol `admin` |
| El botón "Instalar aplicación" no aparece | El navegador no ofrece la instalación (iOS siempre, o ya está instalada, o no es HTTPS) | En iPhone: Compartir → Agregar a inicio. En computadora: icono de instalar en la barra de direcciones |
| Los cambios publicados no se ven | El equipo está usando la copia guardada | Pulsar **Actualizar** en el aviso de versión nueva; si no aparece, cerrar y volver a abrir la aplicación. Al publicar, subir el número `VERSION` en `sw.js` |
| "Error de Conexión" al abrir | La hoja dejó de estar publicada o cambió la URL | Volver a publicar en la web y actualizar las URLs (o revisar la configuración de Apps Script si `ORIGEN_DATOS = 'appsscript'`) |
| Aviso amarillo "no se pudo descargar la hoja de KPIs" | Solo la pestaña de KPIs falló o cambió de URL/nombre | Revisar la publicación/nombre de esa pestaña; el resto del panel sigue operando |
| Fechas invertidas (día↔mes) | La hoja de Sheets está en configuración regional US | Cambiar `FORMATO_FECHA` a `'MDY'`, o la hoja a español |
| Un cliente aparece duplicado en la barra lateral | Variaciones de escritura en `UNIDAD:` | Unificar el nombre en Jotform (lista desplegable) |
| Una orden no aparece en ninguna pestaña | Su tipo de servicio no contiene ninguna palabra clave de clasificación | Revisar el valor de `TIPO DE SERVICIO O MANTENIMIENTO` |
| La sección V de la rutina sale vacía | El campo `Valores de Medición` está vacío o la columna cambió de nombre | Verificar la orden en Jotform / encabezado de la hoja |
| Los datos no reflejan cambios recientes | Retraso de publicación de Google Sheets | Esperar unos minutos y usar el botón **Actualizar** |
| No aparece la pantalla de identificación | El control de acceso solo se activa con PIN definido o backend configurado | Definir `CONTROL_ACCESO.pin` y/o `URL_APPS_SCRIPT` |
| El seguimiento dice "N cambios por enviar" | Sin conexión, URL de Apps Script incorrecta o token distinto | Hacer clic en el indicador para reintentar; verificar `…/exec?accion=ping` y que `TOKEN_API` = `TOKEN` |
| La bitácora no registra nada | `URL_APPS_SCRIPT` vacío o implementación sin acceso "Cualquier usuario" | Revisar la sección 3 (pasos del backend) y volver a implementar |
| WhatsApp abre sin destinatario | El canal no tiene número válido | Verificar que el número tenga 10 dígitos (o incluya lada internacional) |
| El correo no se envía y aparece un error de autorización | Falta conceder los permisos de Gmail al script | Abrir Apps Script, ejecutar `autorizarPermisos` una vez, aceptar los permisos y volver a implementar (*Administrar implementaciones → editar → Nueva versión*) |
| El correo falla por tamaño | Los adjuntos superan 10 MB | Subir el archivo a Drive y compartir el enlace en el cuerpo del mensaje |
| Se agotó la cuota de correos | Límite diario de la cuenta (~100 en Gmail personal, ~1500 en Workspace) | Esperar al día siguiente o usar el modo *Guardar borrador en Gmail* |
| Los datos no cambian aunque se actualizó la hoja | Caché de sesión o del backend | Usar el botón **Actualizar** (fuerza descarga fresca en ambos niveles) |
| Una orden con "X" sigue apareciendo | El encabezado cambió de nombre en la hoja (revisar el aviso en la consola del navegador, F12) | Ajustar `COLUMNA_EXCLUSION` al nombre real y usar **Actualizar** para saltar la caché |
| Desaparecieron órdenes que sí deberían contarse | La celda de `Indicador de Prueba` trae un valor de `MARCAS_EXCLUSION` sin querer | Vaciar la celda en la hoja o ajustar `MARCAS_EXCLUSION` |
| La rutina dice "no se encontró en el catálogo" | El nombre del patrón en la orden no coincide con ninguno del catálogo, o es demasiado genérico | Unificar el nombre en la pestaña `datos equipo de calibracion` o en el formulario de Jotform |
| Falta un equipo en la tabla de la sección IV | Su nombre, modelo y serie no aparecen en el texto de la orden | Escribir el modelo o la serie en el campo de la orden, o unificar el nombre en el catálogo |
| No aparece la tabla de certificados y vigencias | La pestaña no existe, cambió de nombre, o con `ORIGEN_DATOS = 'csv'` falta `csvUrlPatrones` | Verificar `HOJA_PATRONES` en `Code.gs` y volver a implementar (*Nueva versión*) |
| Las gráficas no salen al imprimir o al guardar en PDF | Versión anterior a la 2.8.2 (Grid fragmentado, sección con `break-inside: avoid` más alta que la página, o imagen sin decodificar) | Actualizar a la 2.8.2; si persiste, verificar que en el diálogo esté activada la opción **"Gráficos de fondo"** |
| Al imprimir aparecen el título y la URL del navegador | Casilla "Encabezados y pies de página" activa en el diálogo | Desactivarla; el margen de 1 cm ya lo aplica el documento |
| La leyenda de rango de operación dice "No definido" | El parámetro no tiene regla en `RANGOS_OPERACION` | Agregar la clave del parámetro a esa tabla (sección 4.3) |

---

## 8. Historial de versiones

| Versión | Cambios principales |
|---|---|
| 3.5 | Atiende las tres observaciones de los ingenieros sobre el generador de rutinas. **La tolerancia depende del tipo de equipo**: 5 % en soporte de vida (desfibrilador, máquina de anestesia, ventilador y vaporizador) y 10 % en el resto, en sustitución del criterio por parámetro, que queda disponible con `CRITERIO_TOLERANCIA = 'parametro'`. **Se evalúa también desplegado contra medido**: cuando la orden no trae valor programado —temperatura, presión de vía aérea, flujo— la referencia es el valor medido por el analizador y se evalúa lo que desplegó el equipo, así que esos renglones por fin tienen error y gráfica. **Rangos que no se cargaban**: los expresados como relación (`I:E 4:1-1:9`) se conservan como texto en lugar de intentar convertirlos en números, y los parámetros sin valor programado ya heredan el rango de su encabezado, con verificación de unidad para que un renglón de temperatura no herede el rango de flujo por estar debajo |
| 3.4.2 | Los iconos pasan a la **raíz del repositorio**, sin la carpeta `iconos/`: era el paso donde se perdían al publicar, y su ausencia impedía la instalación sin explicación visible |
| 3.4.1 | **Diagnóstico de instalación.** Cuando el navegador no ofrece instalar, no dice cuál requisito falta: simplemente no muestra el icono. Este diagnóstico los revisa uno por uno —HTTPS, manifiesto accesible y completo, iconos que se descargan, service worker activo, `sw.js` alcanzable— y señala en rojo el que falla. Se abre desde el enlace al pie del menú lateral o agregando `?diagnostico=1` a la dirección |
| 3.4 | **La plataforma se instala como aplicación (PWA).** Se agrega a la pantalla de inicio del teléfono o al escritorio y abre sin barra del navegador, con el isotipo institucional como icono. Un *service worker* guarda copia de la página y de las librerías externas —Tailwind, Chart.js, PapaParse, la tipografía—, de modo que la plataforma abre aunque la red del hospital bloquee esos dominios, y guarda también la última descarga de datos para poder consultar sin señal. Aviso en pantalla cuando hay una versión nueva, con botón para aplicarla |
| 3.3 | **Pantalla de carga con avance real.** Sustituye la leyenda "Conectando con Google Sheets y procesando datos…" por **"Preparando su información"** con un anillo de progreso y un contador de 0 a 100 %. El porcentaje no es un temporizador: cada etapa lo empuja cuando termina de verdad —descarga de cada hoja, lectura, organización por unidad, cálculo de mantenimientos, armado del panel— y el 100 % solo aparece con el panel ya listo. Debajo del número se indica la etapa en curso. Aparece tanto al entrar con el PIN como al pulsar **Actualizar**. La geometría de esta pantalla va en estilos en línea para que se vea correcta aunque la hoja de estilos externa tarde o no cargue |
| 3.2 | **El ingreso es solo con PIN**: ya no se captura el nombre. El PIN identifica a la persona y el servidor devuelve su nombre y su rol, de modo que nadie puede entrar con el nombre de otro. Como consecuencia, **el PIN debe ser único por usuario** y el alta lo verifica. El bloqueo por intentos fallidos pasa a contarse **por dispositivo** (ya no hay nombre contra el cual contar), con un tope global como red de seguridad. El código maestro entra con el nombre configurado en `NOMBRE_ADMIN`. Se corrigió además el aviso cuando `CODIGO_ADMIN` tiene menos de 6 caracteres: antes se confundía con un PIN incorrecto y no había forma de saber el motivo real |
| 3.1 | **Modo administrador y alta de usuarios.** El acceso deja de depender de un PIN compartido escrito en el archivo: cada ingeniero entra con su nombre y su PIN, y quien escribe el código maestro entra como administrador y puede dar de alta, desactivar o eliminar usuarios desde la propia plataforma. Con backend configurado, los usuarios viven en la hoja `Usuarios`, los PIN se guardan como huella SHA-256 con sal y **toda la validación ocurre en Apps Script**, que además bloquea por intentos fallidos. El apartado de usuarios no se muestra a quien no es administrador y el servidor rechaza cualquier alta sin credencial válida. **Filtro por año** en preventivos y correctivos, con el selector de meses encadenado al año elegido |
| 3.0.1 | El **error se imprime sin signo** (error absoluto porcentual), tanto el porcentaje como el error en unidades del parámetro; el valor de referencia sigue siendo el medido y, si viene vacío, el desplegado. **Sección III con el valor alineado a la derecha y la unidad impresa aparte** (°C, %); si la orden trae la unidad dentro del dato, se descarta para no duplicarla. **Corrección del pie de página**: la leyenda salía cortada porque el pie sobresalía hacia el margen y el navegador recorta lo que queda fuera del área de página. Ahora va anclado al borde inferior del área de contenido, en una sola línea, con margen inferior de 34 mm y `break-inside: avoid` en los renglones de tabla para que ninguno quede debajo del pie |
| 3.0 | **El error de la sección VI es ahora porcentual**: `(real − programado) ÷ programado × 100`, con signo conservado (conmutable a error absoluto porcentual con `ERROR_PORCENTUAL_ABSOLUTO`), error absoluto disponible en desglose e información emergente y manejo explícito de la división entre cero. **Temperatura y humedad se toman de la orden**: las dos primeras capturas de la tabla de mediciones alimentan la sección III, con salvaguarda para no confundirlas con un parámetro real del equipo. **Rango estándar de operación capturado en la orden**: el ingeniero lo escribe como renglón encabezado antes de las mediciones de cada parámetro y se aplica a todas las que le siguen; se imprime en la columna nueva de la tabla y en la leyenda de cada gráfica, con marca `*` cuando el dato proviene de la configuración y no de la orden. Maneja nombres y unidades con dígitos (`SpO2`, `%O2`) y rangos compuestos (`10/30 – 220/260 mmHg`), que se reparten por componente en las gráficas de sistólica y diastólica. **Sección IV solo con la tabla del catálogo de patrones**; se elimina el texto del formulario. **Pie de página repetido en todas las hojas impresas** con la leyenda de prohibición de reproducción, en sustitución de la leyenda única al final del documento, y aviso en pantalla para desactivar el encabezado del navegador |
| 2.9.1 | La sección IV lista **todos los equipos de calibración utilizados** en una tabla (nombre, marca, modelo, serie, certificado, vigencia y laboratorio), sin límite de cantidad; el emparejamiento reconoce cada equipo por nombre, modelo o número de serie. **Se elimina el distintivo de vigencia** (*Vigente / Por vencer / VENCIDA*) y su advertencia: la vigencia se imprime como dato informativo. Fechas de vigencia con formato fijo `dd/mm/aaaa` |
| 2.9 | **Redondeo unificado a 2 decimales** en todos los cálculos (errores, porcentajes, límites de tolerancia, gráficas e indicadores). **Nueva sección III "Condiciones Ambientales del Servicio"** con temperatura y humedad editables; las secciones siguientes se renumeran (Calibración pasa a IV, Check-List a V, Mediciones a VI, Observaciones a VII, Autorización a VIII). **Dos fechas en el encabezado**: fecha de medición (de la orden de trabajo) y fecha de emisión (día de generación del documento). **Catálogo de equipos de calibración** en la pestaña `datos equipo de calibracion`: la rutina busca el analizador por nombre e imprime marca, modelo, serie, **número de certificado** y **vigencia de la calibración**, con estado *Vigente / Por vencer / VENCIDA* evaluado contra la fecha de medición y advertencia cuando el patrón estaba vencido. Emparejamiento estricto (rechaza coincidencias ambiguas para no imprimir el certificado de otro equipo). Backend `Code.gs` v2.9: nueva hoja servida con `&hoja=patrones` |
| 2.8.2 | **Corrección: las gráficas de la rutina no se imprimían.** Tres causas resueltas: la sección V llevaba `break-inside: avoid` siendo más alta que una página (el navegador desbordaba y recortaba el bloque de gráficas); el contenedor usaba CSS Grid, cuya fragmentación entre páginas es poco confiable en Chrome (se sustituye por `inline-block`); y el lienzo medía su altura en px sobre un contenedor sin altura definida al imprimir, por lo que la imagen salía de 0 px de alto (ahora en mm). Además: conversión de gráficas a imagen disparada desde el propio botón con espera de decodificación (`beforeprint` no dispara en Safari/iOS), bandera anti-duplicado de imágenes, restauración de respaldo si no llega `afterprint`, y conservación del lienzo original cuando la conversión falla, en vez de dejar un hueco. `print-color-adjust: exact` para que Chrome no descarte fondos |
| 2.8 | **Identidad institucional**: paleta tomada del logotipo (#005DA1 / #ABE1F5) aplicada a toda la interfaz, barra lateral en azul institucional, isotipo embebido en favicon, menú lateral y pantalla de acceso. **Columna `Indicador de Prueba`** en la hoja de órdenes ("X" = el registro no se considera en ningún módulo), con detección tolerante de encabezado, aviso en consola si no se encuentra y contador de omitidas. **Márgenes de impresión de 25 mm por lado en todas las páginas**. **Una gráfica por parámetro** en la sección V de la rutina: todas las mediciones de un mismo parámetro comparten gráfica (eje X = número de medición, eje Y izquierdo = valor, eje Y derecho = % de error), y los valores compuestos se separan (PANI Sistólica y PANI Diastólica en gráficas distintas); con banda de intervalo aceptable, líneas del rango de operación y **leyenda impresa de tolerancia y rango estándar de operación** en cada gráfica; nueva tabla configurable `RANGOS_OPERACION`. **Leyenda legal** "Prohibida su reproducción parcial o total sin la autorización de la empresa" al final de la rutina |
| 1.0 | Dashboard, vista por cliente, pestañas preventivo/correctivo, generador de rutinas |
| 2.0 | Corrección de detección de columnas, mes derivado de fecha, parser estructurado de mediciones, normalización de acentos, fechas robustas (seriales/ISO/ambigüedad), exclusión de órdenes de prueba, frecuencias configurables, checklist sin pre-llenar, folio trazable, escape de HTML/CSV, sidebar móvil con buscador, badge de vencidos, KPIs promediados correctamente |
| 2.1 | Gráfica de mediciones solo con valores comparables; eliminación del bloque "Registro Original" |
| 2.2 | Impresión completa de la rutina (multi-página) con interfaz oculta; optimización para móvil |
| 2.3 | Sección VI de Autorización (firma + nombre del responsable) en sustitución de evidencia fotográfica |
| 2.4 | Columna Orden (ID) y filtro por mes de ejecución en la pestaña de preventivos |
| 2.5 | Nueva sección "VI. Observaciones" (texto libre); Autorización pasa a ser VII; tabla de mediciones (sección V) editable con recálculo de Error y gráfica en vivo, y nota al pie con motivo cuando los datos difieren del registro original |
| 2.7 | **Mediciones compuestas**: PANI `120/80` se separa en sistólica y diastólica, cada una con su propio error en tabla y gráfica, con renglón de desglose imprimible; **tolerancias configurables por parámetro** (±3 mmHg para presión, ±2 % SpO₂, ±0.3 °C, ±3 J/±15 % energía) en sustitución del ±10 % fijo; barras de error coloreadas por tolerancia y error relativo en el tooltip. **Envío de seguimientos por correo con adjuntos** vía `GmailApp` (modo enviar o borrador, evidencia fotográfica opcional, bitácora en *Correos enviados* y avance automático en el historial). **Rendimiento**: caché de sesión de 5 minutos para las hojas, caché con `CacheService` en el proxy del backend, búsqueda de filas con `TextFinder` al guardar, sincronización incremental con `&desde=`, debounce en los buscadores y resincronización al volver a la pestaña |
| 2.6 | **Pestaña "Comunicación y Seguimiento" por cliente** (canales de contacto, seguimientos con historial y estatus, envío por WhatsApp, sincronización multi-dispositivo vía Apps Script con cola offline); **control de acceso** (nombre + PIN opcional, sesión con caducidad, cierre de sesión) y **bitácora de accesos y acciones** en Google Sheets; **proxy privado de datos** con token para poder despublicar los CSV; carga tolerante a fallos con aviso no bloqueante; botón Actualizar con sello de hora y conservación de la vista; corrección del cálculo de "Vencido" (hoy no cuenta como vencido); refactor del modal de oportunidades (un solo listener); cierre de modales con `Esc` y clic en el fondo |
