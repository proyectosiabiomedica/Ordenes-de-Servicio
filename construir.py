"""Genera index.html a partir de app.jsx: compila el JSX aquí para que el
teléfono no tenga que descargar Babel (3 MB) ni compilar al abrir."""
import re, subprocess, json

html = open('index.html', encoding='utf-8').read()
fuente = open('app.jsx', encoding='utf-8').read()

compilado = subprocess.run(
    ['node', '-e', '''
const fs=require("fs"),babel=require("@babel/core");
const out=babel.transformSync(fs.readFileSync("app.jsx","utf8"),
  {presets:[[require("@babel/preset-react"),{runtime:"classic"}]],compact:false});
process.stdout.write(out.code);'''],
    capture_output=True, text=True, check=True).stdout

# El registro del service worker queda fuera de la función de arranque
corte = compilado.find('window.__appLista = true;')
codigo_app = compilado

cargador = '''<script>
/* Carga de React con servidores alternos. Si uno está lento o bloqueado por la
   operadora, se prueba el siguiente. Sin Babel: la app ya viene compilada. */
(function () {
  var FUENTES = [
    ["https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js",
     "https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js",
     "https://unpkg.com/react@18.3.1/umd/react.production.min.js"],
    ["https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js",
     "https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js",
     "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"]
  ];
  function cargar(lista, i, listo) {
    if (i >= lista.length) return listo(false);
    var s = document.createElement("script"), hecho = false;
    var t = setTimeout(function () { if (hecho) return; hecho = true; cargar(lista, i + 1, listo); }, 20000);
    s.onload = function () { if (hecho) return; hecho = true; clearTimeout(t); listo(true); };
    s.onerror = function () { if (hecho) return; hecho = true; clearTimeout(t); cargar(lista, i + 1, listo); };
    s.src = lista[i];
    document.head.appendChild(s);
  }
  cargar(FUENTES[0], 0, function (ok) {
    if (!ok || !window.React) return window.__falloCarga("No se pudo descargar React desde ningún servidor.");
    cargar(FUENTES[1], 0, function (ok2) {
      if (!ok2 || !window.ReactDOM) return window.__falloCarga("No se pudo descargar ReactDOM desde ningún servidor.");
      window.__iniciarApp();
    });
  });
})();
</script>'''

# Quitar las tres etiquetas de CDN antiguas y el bloque babel
html = re.sub(r'<script src="https://unpkg\.com/[^"]+"[^>]*></script>\s*', '', html)
bloque = '<script>\nwindow.__iniciarApp = function () {\n' + codigo_app + '\n};\n</script>\n' + cargador
# Reemplazo con función: el código compilado trae barras invertidas que re.sub
# interpretaría como secuencias de escape
html = re.sub(r'<script type="text/babel" data-presets="react">.*?</script>',
              lambda m: bloque, html, flags=re.S)
# Si ya estaba compilado de antes, reemplazar el bloque compilado
html = re.sub(r'<script>\nwindow\.__iniciarApp = function \(\) \{\n.*?\n\};\n</script>\n<script>\n/\* Carga de React.*?</script>',
              lambda m: bloque, html, flags=re.S)
open('index.html', 'w', encoding='utf-8').write(html)
print('index.html generado ·', len(html) // 1024, 'KB')
