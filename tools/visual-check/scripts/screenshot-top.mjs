import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(__dirname, '../iterations/iter-top-premium.png');

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);
const el = page.locator('.engagement-card--highlight').first();
await el.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
const box = await el.boundingBox();
if (!box) throw new Error('not found');
await page.screenshot({
  path: out,
  clip: {
    x: Math.max(0, box.x - 20),
    y: Math.max(0, box.y - 30),
    width: box.width + 40,
    height: 100,
  },
});
console.log(`Wrote ${out}`);
await browser.close();
