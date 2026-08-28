# Orden de Trabajo · App para ingenieros de servicio

App web instalable (PWA) que reemplaza el llenado directo del formulario de Jotform
`Orden de Trabajo` (ID **260445478825062**) por una captura por pasos, con borradores
locales, cola de envío offline y consulta de envíos propios.

## Archivos

| Archivo | Dónde va |
|---|---|
| `index.html` | Repositorio de GitHub Pages |
| `sw.js` | Repositorio (mismo nivel que index.html) |
| `manifest.json` | Repositorio |
| `icon-192.png`, `icon-512.png` | Repositorio |
| `Codigo.gs` | Proyecto de Google Apps Script |

## 1. Backend (Apps Script)

1. script.google.com → **Nuevo proyecto**, pegar `Codigo.gs`.
2. Editar el bloque `CONFIG`:
   - `API_KEY`: la llave de la cuenta `proyectosiabiomedica`
     (Jotform → Settings → API → Create New Key, permiso **Full Access**).
   - `TOKEN`: invente una cadena larga; irá también en `index.html`.
   - `DRIVE_FOLDER_ID`: opcional, carpeta donde se guardan las fotos.
   - `SHEET_ID`: opcional, hoja de bitácora de envíos.
3. Ejecutar la función `probarConexion` una vez. Autorizar los permisos.
   En el registro debe aparecer la lista de preguntas con su `qid`, `tipo` y texto.
   **Guarde ese registro**: es la referencia para ajustar cualquier campo.
4. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
5. Copiar la URL `/exec`.

## 2. Frontend (GitHub Pages)

1. Subir los cinco archivos a un repositorio (puede ser el mismo que ya usa) y
   activar Pages en Settings → Pages → rama `main`, carpeta `/root`.
2. En `index.html`, bloque `window.CONFIG` (línea ~180):
   - `PROXY_URL`: la URL `/exec` del paso anterior.
   - `TOKEN`: el mismo del Apps Script.
3. Abrir la URL de Pages en el celular → menú del navegador → **Agregar a pantalla de inicio**.

> Debe abrirse desde `https://` para que funcionen el service worker y la instalación.
> Abrir el archivo con doble clic (`file://`) desactiva el modo offline.

## 3. Cómo trabaja la app

- **Identificación**: cada ingeniero elige su nombre una sola vez; queda en el dispositivo
  y filtra borradores y envíos.
- **Borradores**: autoguardado en IndexedDB cada vez que se escribe. Sobreviven a cierres,
  reinicios y falta de señal. Se pueden retomar en el paso donde se dejaron.
- **Por enviar**: al terminar una orden pasa a una cola. Si hay señal se manda de inmediato;
  si no, se reintenta sola al reconectar o con el botón *Reintentar ahora*.
  Si algo falla, la orden se puede devolver a borradores sin perder nada.
- **Mis envíos**: consulta las submissions reales de Jotform filtradas por el nombre del
  ingeniero. La última consulta queda en caché para verla sin señal.
- **Ajustes**: muestra la correspondencia campo de la app → `qid` del formulario, y avisa
  si algún campo dejó de encontrarse (por ejemplo, si alguien renombra una pregunta en Jotform).

Los campos no se enlazan por número fijo sino por el texto de la pregunta, resuelto contra
el esquema que el proxy descarga de Jotform. Si mañana se agrega una pregunta al formulario,
la app no se rompe.

## 4. Dos puntos que hay que verificar con el primer envío real

1. **Firmas.** Se envían como PNG en base64 al campo `control_signature`. Si en la submission
   la firma aparece como texto en lugar de imagen, hay que cambiar la línea `if (tipo === 'firma')`
   de `Codigo.gs` para subir el PNG a Drive y mandar la URL.
2. **Fotos.** Por defecto (`ADJUNTAR_EN_JOTFORM: false`) se suben a Drive y sus enlaces se anexan
   al final de OBSERVACIONES. Si prefiere que queden en el campo *Carga de archivo* del formulario,
   ponga la bandera en `true` y pruebe con una foto.

Con el registro de `probarConexion` a la vista puedo ajustar cualquiera de los dos.

## 5. Notas

- El formulario tiene la pregunta 1 escrita como *"LIMPIEZA Y DESINFECCI N"* (falta la Ó).
  La app la localiza por el prefijo `1.-`, así que funciona igual; si corrige el texto en
  Jotform, tampoco se rompe.
- *Valores de Medición* se captura como tabla (parámetro / referencia / medido / unidad) y
  se envía como texto en varias líneas. Si en Jotform ese campo es una tabla de entrada,
  conviene ajustar el serializador.
- Los cuatro campos *OTRO:* y las tres *Firma* se distinguen por orden de aparición.
- Al publicar cambios, suba el número de versión en `sw.js` (`ot-ia-v1` → `ot-ia-v2`)
  para que los celulares tomen la versión nueva.
