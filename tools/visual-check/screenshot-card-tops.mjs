// Tight crop of the engagement cards' TOP edges — to inspect the upward
// halo + specular catchlight in detail. Captures ~80px above the cards
// + the first ~140px of each card.
// Usage: node screenshot-card-tops.mjs [label] [url]

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const LABEL = process.argv[2] || 'card-tops';
const URL = process.argv[3] || 'http://localhost:4200/';

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);

  const grid = page.locator('.engagements__grid').first();
  await grid.waitFor({ state: 'attached', timeout: 15000 });
  await grid.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.waitForTimeout(1200);

  const box = await grid.boundingBox();
  if (!box) throw new Error('no bounding box');

  // Capture: 100px above the grid + first 200px of the grid = 300px tall
  const clip = {
    x: Math.max(0, box.x - 24),
    y: Math.max(0, box.y - 100),
    width: Math.min(1440 - Math.max(0, box.x - 24), box.width + 48),
    height: 300,
  };

  const out = join(OUT_DIR, `card-tops-${LABEL}.png`);
  await page.screenshot({ path: out, clip });
  console.log(`✓ ${out}`);
  await browser.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
