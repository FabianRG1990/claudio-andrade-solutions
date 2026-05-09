// Self-host Roboto eliminando la dependencia de fonts.googleapis.com.
// Beneficio: 0 round trips externos en el critical path. Google Fonts
// tradicionalmente cuesta ~200-400 ms en first paint (DNS + TLS +
// stylesheet + woff2). Con self-host eso baja a 0 — los woff2 viajan
// junto con el HTML/JS desde el mismo origen.
//
// Pesos cargados: 300/400/500 normal + italic 400/500 (los mismos que
// pedimos a Google). Solo subset `latin` (sin extended/cyrillic/greek/
// vietnamese) — el sitio es 100% español sin caracteres exóticos.
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(__dirname, '..', 'apps/claudio-andrade-solutions/public/fonts');
mkdirSync(FONTS_DIR, { recursive: true });

const GFONTS_URL =
  'https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,300;0,400;0,500;1,400;1,500&display=swap';

// User-Agent moderno para que Google sirva woff2 (sino devuelve woff/ttf).
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

console.log('Fetching CSS from Google Fonts...');
const css = await fetch(GFONTS_URL, { headers: { 'User-Agent': UA } }).then((r) => r.text());

// Sólo conservamos los @font-face que tengan unicode-range latin
// (U+0000-00FF + U+0131 + ...). Google los marca con un comentario
// /* latin */ justo antes del bloque.
const blocks = css.split('@font-face').slice(1);
const latinBlocks = [];
for (const block of blocks) {
  // Buscar hacia atrás: el comentario que precede al bloque indica el subset
  const fullPos = css.indexOf('@font-face' + block);
  const before = css.slice(Math.max(0, fullPos - 50), fullPos);
  if (/\/\*\s*latin\s*\*\//.test(before)) {
    latinBlocks.push('@font-face' + block.split('@font-face')[0]);
  }
}
console.log(`Found ${latinBlocks.length} latin @font-face blocks (expected 5: 300/400/500 + 400i/500i)`);

let outCss = '';
let downloaded = 0;
let totalBytes = 0;

for (const block of latinBlocks) {
  // Extraer la URL del woff2
  const urlMatch = block.match(/url\(([^)]+\.woff2)\)/);
  if (!urlMatch) continue;
  const woffUrl = urlMatch[1];

  // Extraer weight + style del bloque para nombrar el archivo
  const weight = (block.match(/font-weight:\s*(\d+)/) || [, '400'])[1];
  const isItalic = /font-style:\s*italic/.test(block);
  const filename = `roboto-${weight}${isItalic ? 'i' : ''}.woff2`;

  console.log(`  Downloading ${filename}...`);
  const buf = await fetch(woffUrl).then((r) => r.arrayBuffer());
  writeFileSync(resolve(FONTS_DIR, filename), Buffer.from(buf));
  downloaded++;
  totalBytes += buf.byteLength;

  // Reescribir el bloque con la URL local
  const localBlock = block.replace(/url\([^)]+\.woff2\)/, `url(/fonts/${filename})`);
  outCss += localBlock + '\n';
}

writeFileSync(resolve(FONTS_DIR, 'roboto.css'), outCss);
console.log(`\nDownloaded ${downloaded} woff2 files, total ${(totalBytes / 1024).toFixed(0)} KB`);
console.log(`Wrote: ${FONTS_DIR}/roboto.css`);
