#!/usr/bin/env node
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REF = resolve(__dirname, '..', 'reference', 'engagements-reference.png');
const OUT = resolve(__dirname, '..', 'iterations');

const meta = await sharp(REF).metadata();
const refW = meta.width, refH = meta.height;

// Middle card scarcity sits roughly at center-x, y ~85-87% of height (above the brass CTA).
const cardW = Math.round(refW / 3);
const midX = Math.round(refW / 2 - cardW / 2);
const sy = Math.round(refH * 0.83);
const sh = Math.round(refH * 0.045);
await sharp(REF).extract({ left: midX, top: sy, width: cardW, height: sh })
  .resize({ width: cardW * 2, kernel: 'nearest' })
  .toFile(join(OUT, 'ref-scarcity-zoom.png'));

// CTA label zoom (side and mid).
const ctaY = Math.round(refH * 0.91 - refH * 0.08);
const ctaH = Math.round(refH * 0.08);
await sharp(REF).extract({ left: 60, top: ctaY, width: cardW - 100, height: ctaH })
  .resize({ width: (cardW - 100) * 2, kernel: 'nearest' })
  .toFile(join(OUT, 'ref-cta-text-side.png'));
await sharp(REF).extract({ left: midX + 30, top: ctaY, width: cardW - 60, height: ctaH })
  .resize({ width: (cardW - 60) * 2, kernel: 'nearest' })
  .toFile(join(OUT, 'ref-cta-text-mid.png'));

// Sample scarcity color: pick a few pixels at the text band.
const rgba = await sharp(REF).extract({ left: midX, top: sy, width: cardW, height: sh })
  .raw().toBuffer({ resolveWithObject: true });
const { data, info } = rgba;
const samples = [];
for (let y = 0; y < info.height; y += 3) {
  for (let x = 0; x < info.width; x += 5) {
    const i = (y * info.width + x) * info.channels;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Yellow pixels: r > 180, g > 130, b < 100
    if (r > 180 && g > 130 && b < 100) samples.push([r, g, b]);
  }
}
if (samples.length) {
  const avg = samples.reduce((a, s) => [a[0] + s[0], a[1] + s[1], a[2] + s[2]], [0, 0, 0]).map(v => Math.round(v / samples.length));
  console.log(`Scarcity yellow avg from ${samples.length} samples: rgb(${avg.join(',')})`);
  // Sort to find brightest
  samples.sort((a, b) => (b[0] + b[1]) - (a[0] + a[1]));
  console.log(`Top 5 brightest: ${samples.slice(0, 5).map(s => `rgb(${s.join(',')})`).join(', ')}`);
}
console.log('Wrote zoom crops');
