// Genera variantes AVIF + WebP para cada PNG/JPG > 100 KB en `public/`.
// El PNG/JPG original queda como fallback (último <source> en `<picture>`),
// y el navegador elige automáticamente el formato más eficiente que soporta.
//
// AVIF gana 70-90% sobre PNG en fotos, ~50% sobre WebP. WebP gana 25-35%
// sobre PNG y tiene soporte universal desde 2020. PNG queda como red de
// seguridad para Safari < 16 y navegadores muy viejos.
//
// Calidad calibrada para "indistinguible a vista de ojo" en pantallas
// retina:
//   - AVIF q=50, effort=7 — sweet spot calidad/tamaño/tiempo
//   - WebP q=80, effort=6 — calidad alta sin penalizar tiempo de build
import sharp from 'sharp';
import { readdirSync, statSync } from 'fs';
import { resolve, join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'apps/claudio-andrade-solutions/public');
const MIN_SIZE = 100 * 1024; // 100 KB threshold — debajo de eso no vale la pena

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else {
      yield { full, size: st.size };
    }
  }
}

const targets = [];
for (const file of walk(PUBLIC_DIR)) {
  const ext = extname(file.full).toLowerCase();
  if ((ext === '.png' || ext === '.jpg' || ext === '.jpeg') && file.size >= MIN_SIZE) {
    targets.push(file);
  }
}

console.log(`Found ${targets.length} images >= 100 KB to optimize\n`);

let totalOriginal = 0;
let totalAvif = 0;
let totalWebp = 0;

for (const target of targets) {
  totalOriginal += target.size;
  const dir = dirname(target.full);
  const name = basename(target.full, extname(target.full));
  const avifPath = join(dir, `${name}.avif`);
  const webpPath = join(dir, `${name}.webp`);

  await sharp(target.full).avif({ quality: 50, effort: 7 }).toFile(avifPath);
  await sharp(target.full).webp({ quality: 80, effort: 6 }).toFile(webpPath);

  const avifSize = statSync(avifPath).size;
  const webpSize = statSync(webpPath).size;
  totalAvif += avifSize;
  totalWebp += webpSize;

  const rel = target.full.replace(PUBLIC_DIR + '\\', '').replace(PUBLIC_DIR + '/', '');
  const o = (target.size / 1024).toFixed(0);
  const a = (avifSize / 1024).toFixed(0);
  const w = (webpSize / 1024).toFixed(0);
  const aPct = ((1 - avifSize / target.size) * 100).toFixed(0);
  const wPct = ((1 - webpSize / target.size) * 100).toFixed(0);
  console.log(`  ${rel}: ${o}KB → AVIF ${a}KB (-${aPct}%) | WebP ${w}KB (-${wPct}%)`);
}

console.log(`\nTotal original: ${(totalOriginal / 1024 / 1024).toFixed(1)} MB`);
console.log(`Total AVIF:     ${(totalAvif / 1024 / 1024).toFixed(1)} MB (${((1 - totalAvif / totalOriginal) * 100).toFixed(0)}% smaller)`);
console.log(`Total WebP:     ${(totalWebp / 1024 / 1024).toFixed(1)} MB (${((1 - totalWebp / totalOriginal) * 100).toFixed(0)}% smaller)`);
