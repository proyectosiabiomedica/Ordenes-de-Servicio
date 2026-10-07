"""Genera index.html a partir de app.jsx.

Todo queda en un solo archivo —React, ReactDOM y la app ya compilada— para que la
primera apertura sea UNA descarga a UN servidor. Con datos móviles inestables o un
teléfono que alterna entre wifi y datos (ERR_NETWORK_CHANGED), cada descarga
adicional a otro dominio era otra oportunidad de que la carga se cortara.

Uso:  python3 construir.py   (requiere node con @babel/core y @babel/preset-react)
"""
import re, subprocess

html = open('index.html', encoding='utf-8').read()

compilado = subprocess.run(['node', '-e', '''
const fs=require("fs"),babel=require("@babel/core");
process.stdout.write(babel.transformSync(fs.readFileSync("app.jsx","utf8"),
  {presets:[[require("@babel/preset-react"),{runtime:"classic"}]]}).code);'''],
  capture_output=True, text=True, check=True).stdout

def seguro(js):
    # Un "</script" dentro del código cerraría la etiqueta antes de tiempo
    return js.replace('</script', '<\\/script')

react = open('vendor/react.production.min.js', encoding='utf-8').read()
react_dom = open('vendor/react-dom.production.min.js', encoding='utf-8').read()

bloque = ('<!-- APP:INICIO -->\n'
  '<script>/* React 18.3.1 · licencia MIT · https://react.dev */\n' + seguro(react) + '\n</script>\n'
  '<script>/* ReactDOM 18.3.1 · licencia MIT */\n' + seguro(react_dom) + '\n</script>\n'
  '<script>\n/* Aplicación compilada desde app.jsx con construir.py. Para cambiar textos se\n'
  '   puede editar aquí; para cambios de funcionamiento, editar app.jsx y reconstruir. */\n'
  + seguro(compilado) + '\n</script>\n'
  '<!-- APP:FIN -->')

nuevo = re.sub(r'<!-- APP:INICIO -->.*?<!-- APP:FIN -->', lambda m: bloque, html, flags=re.S)
if nuevo == html and '<!-- APP:INICIO -->' not in html:
    raise SystemExit('No se encontraron las marcas APP:INICIO / APP:FIN en index.html')
open('index.html', 'w', encoding='utf-8').write(nuevo)
print('index.html generado ·', len(nuevo.encode('utf-8')) // 1024, 'KB · sin dependencias externas')
