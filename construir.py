"""Genera index.html a partir de app.jsx.

Todo queda en un solo archivo —Preact (con preact/hooks y preact/compat) y la app
ya compilada y minificada— para que la primera apertura sea UNA descarga a UN
servidor. Con datos móviles inestables o un teléfono que alterna entre wifi y datos
(ERR_NETWORK_CHANGED), cada descarga adicional a otro dominio era otra oportunidad
de que la carga se cortara.

Desde Rev.43 las librerías ya viven dentro de index.html, entre las marcas
APP:INICIO / APP:FIN. Este script solo reemplaza el ÚLTIMO <script> de ese bloque
(la aplicación) y deja intactas las librerías, así no hace falta la carpeta vendor/.

Uso:  python3 construir.py
      (requiere node con @babel/core, @babel/preset-react y terser:
       npm i @babel/core @babel/preset-react terser)
"""
import re, subprocess

html = open('index.html', encoding='utf-8').read()

compilado = subprocess.run(['node', '-e', '''
const fs=require("fs"),babel=require("@babel/core"),{minify}=require("terser");
(async()=>{
  const js=babel.transformSync(fs.readFileSync("app.jsx","utf8"),
    {presets:[[require("@babel/preset-react"),{runtime:"classic"}]]}).code;
  const m=await minify(js,{ecma:2020,compress:true,mangle:true});
  process.stdout.write(m.code);
})().catch(e=>{console.error(e);process.exit(1);});'''],
  capture_output=True, text=True, check=True).stdout

def seguro(js):
    # Un "</script" dentro del código cerraría la etiqueta antes de tiempo
    return js.replace('</script', '<\\/script')

m = re.search(r'<!-- APP:INICIO -->.*?<!-- APP:FIN -->', html, flags=re.S)
if not m:
    raise SystemExit('No se encontraron las marcas APP:INICIO / APP:FIN en index.html')
bloque = m.group(0)

ini = bloque.rfind('<script>')
fin = bloque.rfind('</script>')
if ini == -1 or fin < ini:
    raise SystemExit('No se encontró el <script> de la aplicación dentro del bloque APP')

app = ('<script>\n/* Aplicación compilada desde app.jsx con construir.py. No editar aquí:\n'
       '   cambiar app.jsx y volver a ejecutar construir.py. */\n'
       + seguro(compilado) + '\n</script>')
nuevo_bloque = bloque[:ini] + app + bloque[fin + len('</script>'):]

nuevo = html[:m.start()] + nuevo_bloque + html[m.end():]
open('index.html', 'w', encoding='utf-8').write(nuevo)
print('index.html generado ·', len(nuevo.encode('utf-8')) // 1024, 'KB · sin dependencias externas')
