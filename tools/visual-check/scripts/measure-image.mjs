#!/usr/bin/env node
// measure-image.mjs
// Print dimensions + suggested DPR + aspect-ratio for a reference image.
// Usage: node measure-image.mjs <path-to-image>

import sharp from 'sharp';
import { resolve } from 'path';

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('Usage: measure-image.mjs <path-to-image>');
  process.exit(1);
}

function gcd(a, b) { return b ? gcd(b, a % b) : a; }
function reduce(a, b) { const g = gcd(a, b); return `${a / g}:${b / g}`; }

function guessDPR(width, height) {
  // Heuristic: typical UI component screenshots range from 300-1500 CSS px wide.
  // If the image is >1600px wide, DPR=2 likely. If >2400, DPR=3 possible.
  if (width >= 2400 || height >= 2400) return 3;
  if (width >= 1100 || height >= 1100) return 2;
  return 1;
}

async function main() {
  const abs = resolve(imagePath);
  const meta = await sharp(abs).metadata();
  const { width, height, format, channels, density, hasAlpha } = meta;

  const dpr = guessDPR(width, height);
  const cssW = (width / dpr).toFixed(1);
  const cssH = (height / dpr).toFixed(1);
  const aspect = reduce(width, height);

  console.log(`Image: ${imagePath}`);
  console.log(`Format: ${format}, channels: ${channels}, alpha: ${hasAlpha}`);
  if (density) console.log(`Embedded DPI: ${density}`);
  console.log(`Pixel dimensions: ${width} x ${height}`);
  console.log(`Aspect ratio: ${aspect}`);
  console.log('');
  console.log(`Likely DPR: ${dpr}`);
  console.log(`If DPR=${dpr}, CSS dimensions: ${cssW} x ${cssH} px`);
  console.log('');
  console.log('To override DPR assumption, use a different reference image at known scale.');
  console.log('For each dimension you measure in this image, divide by the DPR to get CSS px.');
}

main().catch((e) => { console.error(e); process.exit(1); });
