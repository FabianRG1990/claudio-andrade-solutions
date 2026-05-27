#!/usr/bin/env node
// crop.mjs — crop a PNG to specific dimensions starting from x,y offset.
// Usage: node scripts/crop.mjs <input.png> <output.png> <x> <y> <w> <h>

import sharp from 'sharp';
import { resolve } from 'path';

const [,, input, output, x, y, w, h] = process.argv;
if (!input || !output || x == null || y == null || w == null || h == null) {
  console.error('Usage: crop.mjs <in> <out> <x> <y> <w> <h>');
  process.exit(1);
}

await sharp(resolve(input))
  .extract({ left: +x, top: +y, width: +w, height: +h })
  .toFile(resolve(output));

console.log(`Cropped ${input} -> ${output} (${w}x${h} from ${x},${y})`);
