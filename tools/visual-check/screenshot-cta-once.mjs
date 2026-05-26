// Quick single-CTA screenshot helper for tight iteration. Pass selector and
// label; outputs into tools/visual-check/out/.
//
// Usage: node tools/visual-check/screenshot-cta-once.mjs <selector> <label> [url]

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SELECTOR = process.argv[2];
const LABEL = process.argv[3] || 'snap';
const URL = process.argv[4] || 'http://localhost:4200/';

if (!SELECTOR) {
  console.error('Usage: node screenshot-cta-once.mjs <selector> <label> [url]');
  process.exit(1);
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  console.log(`→ ${URL}`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);

  const loc = page.locator(SELECTOR).first();
  await loc.waitFor({ state: 'attached', timeout: 15000 });
  await loc.evaluate((el) =>
    el.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await page.waitForTimeout(1200);

  const box = await loc.boundingBox();
  if (!box) throw new Error('no bounding box');

  const margin = 48;
  const clip = {
    x: Math.max(0, box.x - margin),
    y: Math.max(0, box.y - margin),
    width: Math.min(1440 - Math.max(0, box.x - margin), box.width + margin * 2),
    height: Math.min(900 - Math.max(0, box.y - margin), box.height + margin * 2),
  };

  const out = join(OUT_DIR, `cta-${LABEL}.png`);
  await page.screenshot({ path: out, clip });
  console.log(`✓ ${out}`);
  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
