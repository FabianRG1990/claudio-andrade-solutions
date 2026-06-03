import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'iterations');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 3,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);

await page.evaluate(() => {
  document.querySelectorAll('.product-card__badge, .product-card .eyebrow, [class*="badge"]').forEach(el => {
    el.style.opacity = '0';
  });
});
await page.waitForTimeout(200);

const el = page.locator('.product-card--xl').first();
await el.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
await page.waitForTimeout(300);

const box = await el.boundingBox();
const clip = { x: box.x, y: box.y, width: 90, height: 90 };
await page.screenshot({ path: join(OUT, 'corner-clean-fixed.png'), clip });
console.log('Wrote corner-clean-fixed.png');
await browser.close();
