#!/usr/bin/env node
// sample-pixel.mjs
// Surgically read pixel(s) from an image at exact coordinates.
// Usage:  node sample-pixel.mjs <image.png> <x> <y>
//         node sample-pixel.mjs <image.png> --line <x1> <y1> <x2> <y2>  (samples line)
//         node sample-pixel.mjs <image.png> --grid <x> <y> <w> <h> <step>  (samples grid)

import sharp from 'sharp';

const args = process.argv.slice(2);
const imagePath = args[0];

if (!imagePath) {
  console.error('Usage:');
  console.error('  sample-pixel.mjs <image.png> <x> <y>');
  console.error('  sample-pixel.mjs <image.png> --line <x1> <y1> <x2> <y2>');
  console.error('  sample-pixel.mjs <image.png> --grid <x> <y> <w> <h> <step>');
  process.exit(1);
}

function rgbToHex(r, g, b) {
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Same oklch conversion as extract-colors.mjs
function rgbToOklch(r, g, b) {
  const srgbToLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lr = srgbToLin(r), lg = srgbToLin(g), lb = srgbToLin(b);
  const l = 0.4122214708*lr + 0.5363325363*lg + 0.0514459929*lb;
  const m = 0.2119034982*lr + 0.6806995451*lg + 0.1073969566*lb;
  const s = 0.0883024619*lr + 0.2817188376*lg + 0.6299787005*lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553*l_ + 0.793617785*m_ - 0.0040720468*s_;
  const a = 1.9779984951*l_ - 2.428592205*m_  + 0.4505937099*s_;
  const bb= 0.0259040371*l_ + 0.7827717662*m_ - 0.808675766*s_;
  const C = Math.sqrt(a*a + bb*bb);
  let H = Math.atan2(bb, a) * 180 / Math.PI; if (H < 0) H += 360;
  return { L, C, H };
}

function oklchString(r, g, b) {
  const { L, C, H } = rgbToOklch(r, g, b);
  return `oklch(${(L*100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(0)})`;
}

async function loadRaw() {
  const img = sharp(imagePath).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

function pixelAt(data, info, x, y) {
  if (x < 0 || y < 0 || x >= info.width || y >= info.height) return null;
  const idx = (y * info.width + x) * info.channels;
  return {
    r: data[idx],
    g: data[idx + 1],
    b: data[idx + 2],
    a: info.channels === 4 ? data[idx + 3] : 255,
  };
}

function printPixel(x, y, p) {
  if (!p) { console.log(`  (${x}, ${y}): OUT OF BOUNDS`); return; }
  const hex = rgbToHex(p.r, p.g, p.b);
  const oklch = oklchString(p.r, p.g, p.b);
  const alpha = p.a === 255 ? '' : `  α=${(p.a/255).toFixed(2)}`;
  console.log(`  (${String(x).padStart(4)}, ${String(y).padStart(4)}): ${hex}  rgb(${p.r}, ${p.g}, ${p.b})  ${oklch}${alpha}`);
}

async function main() {
  const { data, info } = await loadRaw();
  console.log(`Image: ${imagePath} (${info.width}x${info.height}, ${info.channels} channels)`);

  if (args[1] === '--line') {
    const x1 = +args[2], y1 = +args[3], x2 = +args[4], y2 = +args[5];
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(x1 + (x2 - x1) * t);
      const y = Math.round(y1 + (y2 - y1) * t);
      printPixel(x, y, pixelAt(data, info, x, y));
    }
  } else if (args[1] === '--grid') {
    const x0 = +args[2], y0 = +args[3], w = +args[4], h = +args[5], step = +args[6] || 10;
    for (let y = y0; y < y0 + h; y += step) {
      for (let x = x0; x < x0 + w; x += step) {
        printPixel(x, y, pixelAt(data, info, x, y));
      }
    }
  } else {
    const x = +args[1], y = +args[2];
    printPixel(x, y, pixelAt(data, info, x, y));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
