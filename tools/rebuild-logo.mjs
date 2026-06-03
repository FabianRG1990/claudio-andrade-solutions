// rebuild-logo.mjs
//
// Regenera todas las variantes del logo (PNG 32/64/192/512 + WebP 192/512 +
// AVIF 192/512 + favicon.ico) desde un PNG fuente cuadrado con alpha.
//
// Uso:  node tools/rebuild-logo.mjs <ruta-al-source.png>
//
// El script:
//   1. Carga el source y verifica que tenga alpha channel.
//   2. Genera los 4 PNG (resize + lanczos3 para preservar nitidez en sizes
//      chicos sin tocar el alpha).
//   3. Genera WebP a quality 88 + AVIF a quality 60 (compromiso peso/calidad
//      estándar para iconos transparentes).
//   4. Genera favicon.ico multi-frame (16/32/48) usando la librería png-to-ico
//      que arma el header ICO con los PNG buffers — soporta transparencia.
//
// Todos los archivos se escriben a apps/claudio-andrade-solutions/public/.

import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC_DIR = join(ROOT, 'apps', 'claudio-andrade-solutions', 'public');
const LOGO_DIR = join(PUBLIC_DIR, 'logo');

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('USAGE: node tools/rebuild-logo.mjs <path-to-source.png>');
  process.exit(1);
}

const absSource = resolve(sourcePath);
if (!existsSync(absSource)) {
  console.error(`Source not found: ${absSource}`);
  process.exit(1);
}

mkdirSync(LOGO_DIR, { recursive: true });

// Sizes actually used por la app:
//   • 32 — favicon PNG fallback (apps/.../index.html)
//   • 192 — emblem-mark / emblem-stamp (nav, footer, brand-mark) + splash
// El favicon.ico multi-frame (16/32/48) se arma aparte con png-to-ico.
// Si en el futuro hace falta otro tamaño (ej. 512 para Open Graph share
// images), añadirlo acá y a VECTOR_FORMAT_SIZES si necesita webp/avif.
const SIZES = [32, 192];
const VECTOR_FORMAT_SIZES = [192];

const meta = await sharp(absSource).metadata();
console.log(
  `Source: ${meta.width}×${meta.height}, format=${meta.format}, hasAlpha=${meta.hasAlpha}`,
);
if (meta.width !== meta.height) {
  console.warn(`WARN: source is not square (${meta.width}×${meta.height}).`);
}
if (!meta.hasAlpha) {
  console.warn(`WARN: source has no alpha channel — output will be opaque.`);
}

// Buffers para favicon.ico (16/32/48).
const faviconBuffers = [];

for (const size of SIZES) {
  // Lanczos3 preserva detalle en sizes chicos; alpha se preserva automático.
  const base = sharp(absSource).resize(size, size, {
    kernel: 'lanczos3',
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

  // PNG (todos los tamaños)
  const pngBuf = await base.clone().png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(LOGO_DIR, `logo-${size}.png`), pngBuf);
  console.log(`  ✓ logo-${size}.png  (${pngBuf.length} bytes)`);

  // WebP/AVIF sólo para 192 y 512
  if (VECTOR_FORMAT_SIZES.includes(size)) {
    const webpBuf = await base.clone().webp({ quality: 88 }).toBuffer();
    writeFileSync(join(LOGO_DIR, `logo-${size}.webp`), webpBuf);
    console.log(`  ✓ logo-${size}.webp (${webpBuf.length} bytes)`);

    const avifBuf = await base.clone().avif({ quality: 60 }).toBuffer();
    writeFileSync(join(LOGO_DIR, `logo-${size}.avif`), avifBuf);
    console.log(`  ✓ logo-${size}.avif (${avifBuf.length} bytes)`);
  }
}

// favicon.ico multi-frame (16/32/48). png-to-ico acepta buffers PNG y arma
// el ICO. 48 es el max que pide Windows para HiDPI taskbar icons; 16 es el
// tab icon legacy; 32 es el "moderno" estándar.
const faviconSizes = [16, 32, 48];
for (const s of faviconSizes) {
  faviconBuffers.push(
    await sharp(absSource)
      .resize(s, s, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
}
const icoBuffer = await pngToIco(faviconBuffers);
writeFileSync(join(PUBLIC_DIR, 'favicon.ico'), icoBuffer);
console.log(`  ✓ favicon.ico  (${icoBuffer.length} bytes, frames=${faviconSizes.join('/')})`);

console.log('\nDone. All logo assets regenerated.');
