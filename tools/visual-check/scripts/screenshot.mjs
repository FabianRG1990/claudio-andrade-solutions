#!/usr/bin/env node
// screenshot.mjs
// Capture a tight screenshot of a component in the local dev server.
// Usage:
//   node scripts/screenshot.mjs <selector> [output-name] [--url URL] [--light] [--mobile] [--vp WxH] [--clip x,y,w,h]
// Examples:
//   node scripts/screenshot.mjs '.engagement-card--highlight'
//   node scripts/screenshot.mjs '.btn-primary' btn-001 --light
//   node scripts/screenshot.mjs '.engagements__grid' grid --clip 0,0,full,120

import { chromium } from 'playwright';
import { mkdir, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'iterations');

function parseArgs(argv) {
  const args = { selector: null, name: null, url: 'http://localhost:4200/', scheme: 'dark', viewport: { width: 1440, height: 900 }, clip: null, dpr: 2 };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--light') args.scheme = 'light';
    else if (a === '--dark') args.scheme = 'dark';
    else if (a === '--mobile') args.viewport = { width: 393, height: 852 };
    else if (a === '--vp') {
      const [w, h] = argv[++i].split('x').map(Number);
      args.viewport = { width: w, height: h };
    } else if (a === '--dpr') {
      args.dpr = parseFloat(argv[++i]);
    } else if (a === '--clip') {
      args.clip = argv[++i];  // parsed later, after we have bounding box
    } else positional.push(a);
  }
  args.selector = positional[0];
  args.name = positional[1];
  return args;
}

async function nextIterName() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = await readdir(OUT_DIR).catch(() => []);
  const iters = files
    .map((f) => f.match(/^iter-(\d+)\.png$/))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  const next = iters.length ? Math.max(...iters) + 1 : 1;
  return `iter-${String(next).padStart(3, '0')}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.selector) {
    console.error('Usage: screenshot.mjs <selector> [output-name] [--url URL] [--light] [--mobile] [--vp WxH] [--clip x,y,w,h]');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: args.viewport,
      deviceScaleFactor: args.dpr,
      colorScheme: args.scheme,
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);

    const el = page.locator(args.selector).first();
    await el.waitFor({ state: 'attached', timeout: 15000 });
    await el.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(500);

    const box = await el.boundingBox();
    if (!box) throw new Error(`No bounding box for ${args.selector}`);

    let clip;
    if (args.clip) {
      const [cx, cy, cw, ch] = args.clip.split(',');
      const w = cw === 'full' ? box.width : parseFloat(cw);
      const h = ch === 'full' ? box.height : parseFloat(ch);
      clip = { x: box.x + parseFloat(cx), y: box.y + parseFloat(cy), width: w, height: h };
    } else {
      clip = { x: box.x, y: box.y, width: box.width, height: box.height };
    }

    const name = args.name || (await nextIterName());
    const outPath = join(OUT_DIR, `${name}.png`);
    await page.screenshot({ path: outPath, clip });
    console.log(`Wrote ${outPath} (${Math.round(clip.width * args.dpr)}x${Math.round(clip.height * args.dpr)} px at DPR ${args.dpr})`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
