#!/usr/bin/env node
// extract-colors.mjs
// Extract dominant color palette from a reference image.
// Usage:  node extract-colors.mjs <path-to-image.png> [count]
// Defaults to 8 colors.

import { extractColors } from 'extract-colors';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

const imagePath = process.argv[2];
const count = parseInt(process.argv[3] || '8', 10);

if (!imagePath) {
  console.error('Usage: extract-colors.mjs <path-to-image.png> [count]');
  process.exit(1);
}

function rgbToHex(r, g, b) {
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Linear-light conversion + OKLab transform.
// Reference: https://bottosson.github.io/posts/oklab/
function rgbToOklch(r, g, b) {
  const srgbToLin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lr = srgbToLin(r);
  const lg = srgbToLin(g);
  const lb = srgbToLin(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.sqrt(a * a + bb * bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return { L, C, H };
}

function oklchString(r, g, b) {
  const { L, C, H } = rgbToOklch(r, g, b);
  return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(0)})`;
}

async function main() {
  const abs = resolve(imagePath);
  const buf = await readFile(abs);

  // extract-colors works on Buffer or HTMLImageElement; for node we use Buffer with a known MIME.
  // Newer extract-colors accepts a Buffer/Uint8Array directly with the auto-detect option.
  const colors = await extractColors(buf, {
    pixels: 64000,
    distance: 0.16,
    saturationDistance: 0.18,
    lightnessDistance: 0.18,
    hueDistance: 0.083,
  });

  // Sort by area (dominance) descending.
  colors.sort((a, b) => b.area - a.area);
  const top = colors.slice(0, count);

  console.log(`Top ${top.length} colors (${imagePath}):`);
  for (let i = 0; i < top.length; i++) {
    const c = top[i];
    const hex = rgbToHex(c.red, c.green, c.blue);
    const oklch = oklchString(c.red, c.green, c.blue);
    const pct = (c.area * 100).toFixed(1);
    const idx = String(i + 1).padStart(2, ' ');
    console.log(`  ${idx}. ${hex}  ${oklch.padEnd(28, ' ')}  ${pct}%`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
