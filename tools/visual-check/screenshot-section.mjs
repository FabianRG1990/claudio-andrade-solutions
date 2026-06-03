// Screenshot a full section (the head bar) for layout context.
// Usage: node screenshot-section.mjs <section-selector> <label>

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SELECTOR = process.argv[2];
const LABEL = process.argv[3] || 'section';
const URL = process.argv[4] || 'http://localhost:4200/';

if (!SELECTOR) {
  console.error('Usage: node screenshot-section.mjs <selector> <label> [url]');
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
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);

  const loc = page.locator(SELECTOR).first();
  await loc.waitFor({ state: 'attached', timeout: 15000 });
  await loc.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.waitForTimeout(1500);

  const out = join(OUT_DIR, `section-${LABEL}.png`);
  await loc.screenshot({ path: out });
  console.log(`✓ ${out}`);
  await browser.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
