#!/usr/bin/env node
// Crop the CTA buttons from the reference image to inspect arrows.
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REF = resolve(__dirname, '..', 'reference', 'engagements-reference.png');
const OUT = resolve(__dirname, '..', 'iterations');

const meta = await sharp(REF).metadata();
console.log(`Ref dims: ${meta.width}x${meta.height}`);

// Reference image dims observed ~600x442 (approximate based on display).
// CTA buttons are near the bottom. Let's crop the bottom row.
// We'll crop a wide horizontal band ~70px tall near y=0.93 of height.
const refW = meta.width;
const refH = meta.height;

// Three CTAs across — split image horizontally into thirds for each card,
// crop bottom band ~7% of height.
const bandH = Math.round(refH * 0.08);
const bandY = Math.round(refH * 0.91 - bandH);

await sharp(REF).extract({ left: 0, top: bandY, width: refW, height: bandH }).toFile(join(OUT, 'ref-ctas-row.png'));
console.log(`Wrote ref-ctas-row.png (${refW}x${bandH})`);

// Now zoom into the right side of each card CTA — where the arrow sits.
// Each card is ~1/3 of width, arrow on right side near right edge.
const cardW = Math.round(refW / 3);
// Arrow occupies roughly the last 80px of the button (right side).
const arrowZoneW = 120;
for (let i = 0; i < 3; i++) {
  const x = Math.round((i + 1) * cardW - arrowZoneW - 40);
  await sharp(REF).extract({ left: x, top: bandY, width: arrowZoneW, height: bandH })
    .resize({ width: arrowZoneW * 3, kernel: 'nearest' })
    .toFile(join(OUT, `ref-arrow-${i + 1}-zoom.png`));
  console.log(`Wrote ref-arrow-${i + 1}-zoom.png (3x zoom)`);
}
