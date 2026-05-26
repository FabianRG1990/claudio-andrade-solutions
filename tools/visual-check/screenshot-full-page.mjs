// Full-page screenshot of a route, scrolled to a specific selector. Captures
// the area from the selector down by N px for inspecting layout in context.
// Usage: node screenshot-full-page.mjs <selector> <label> [heightBelow] [url]

import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SELECTOR = process.argv[2];
const LABEL = process.argv[3] || 'page';
const HEIGHT = parseInt(process.argv[4] || '1100', 10);
const URL = process.argv[5] || 'http://localhost:4200/';

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: HEIGHT },
    deviceScaleFactor: 1.5,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  const loc = page.locator(SELECTOR).first();
  await loc.waitFor({ state: 'attached', timeout: 15000 });
  await loc.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.waitForTimeout(1500);

  const out = join(OUT_DIR, `page-${LABEL}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`✓ ${out}`);
  await browser.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
