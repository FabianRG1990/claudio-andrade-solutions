#!/usr/bin/env node
// diff.mjs
// Pixel-diff a screenshot against a reference image.
// Usage:  node scripts/diff.mjs <reference.png> <sample.png> [--include-aa] [--threshold N]
// Output:
//   diff: 1.42% (9648 / 678400 pixels)
//   diff image: iterations/diff-<sample-name>.png

import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname, basename, join, extname } from 'path';

function parseArgs(argv) {
  const args = { ref: null, sample: null, includeAA: false, threshold: 0.10 };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--include-aa') args.includeAA = true;
    else if (a === '--threshold') args.threshold = parseFloat(argv[++i]);
    else positional.push(a);
  }
  args.ref = positional[0];
  args.sample = positional[1];
  return args;
}

async function loadPng(path) {
  const buf = await readFile(path);
  return PNG.sync.read(buf);
}

async function resizeToMatch(samplePath, w, h) {
  const buf = await sharp(samplePath).resize(w, h, { fit: 'fill' }).png().toBuffer();
  return PNG.sync.read(buf);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.ref || !args.sample) {
    console.error('Usage: diff.mjs <reference.png> <sample.png> [--include-aa] [--threshold N]');
    process.exit(1);
  }

  const refPath = resolve(args.ref);
  const samplePath = resolve(args.sample);

  const ref = await loadPng(refPath);
  let sample = await loadPng(samplePath);

  if (ref.width !== sample.width || ref.height !== sample.height) {
    console.warn(`! dimension mismatch: ref ${ref.width}x${ref.height}, sample ${sample.width}x${sample.height}`);
    console.warn(`  resizing sample to match reference (lossy)`);
    sample = await resizeToMatch(samplePath, ref.width, ref.height);
  }

  const { width, height } = ref;
  const diff = new PNG({ width, height });

  const diffPixels = pixelmatch(ref.data, sample.data, diff.data, width, height, {
    threshold: args.threshold,
    includeAA: args.includeAA,
    alpha: 0.6,
    diffColor: [255, 0, 64],     // bright magenta-red
    diffColorAlt: [0, 200, 255],  // cyan for inverted differences
  });

  const total = width * height;
  const pct = (diffPixels / total) * 100;

  const outDir = dirname(samplePath);
  const sampleName = basename(samplePath, extname(samplePath));
  const diffPath = join(outDir, `diff-${sampleName}.png`);
  await writeFile(diffPath, PNG.sync.write(diff));

  console.log(`diff: ${pct.toFixed(2)}% (${diffPixels} / ${total} pixels)`);
  console.log(`diff image: ${diffPath}`);

  if (pct < 0.5) console.log('  → indistinguishable. likely done.');
  else if (pct < 2) console.log('  → small differences. inspect the diff image.');
  else if (pct < 5) console.log('  → noticeable differences. one feature likely wrong.');
  else console.log('  → large differences. major delta to investigate.');
}

main().catch((e) => { console.error(e); process.exit(1); });
