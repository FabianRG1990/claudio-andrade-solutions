// Screenshot the area from one selector to another (or extending below a
// selector by Npx). Useful to capture a CTA + its surrounding section context.
// Usage: node screenshot-area.mjs <selector> <label> [extendPx] [url]

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SELECTOR = process.argv[2];
const LABEL = process.argv[3] || 'area';
const EXTEND_ABOVE = parseInt(process.argv[4] || '480', 10);
const URL = process.argv[5] || 'http://localhost:4200/';

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

  const loc = page.locator(SELECTOR).first();
  await loc.waitFor({ state: 'attached', timeout: 15000 });
  await loc.evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
  await page.waitForTimeout(1200);

  // Compute clip: window-relative box of selector, extend upward EXTEND_ABOVE px.
  const box = await loc.boundingBox();
  if (!box) throw new Error('no bounding box');

  const yStart = Math.max(0, box.y - EXTEND_ABOVE);
  const clip = {
    x: 0,
    y: yStart,
    width: 1440,
    height: Math.min(900 - yStart, box.y - yStart + box.height + 80),
  };

  const out = join(OUT_DIR, `area-${LABEL}.png`);
  await page.screenshot({ path: out, clip });
  console.log(`✓ ${out}`);
  await browser.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
