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
  deviceScaleFactor: 4,
  colorScheme: 'dark',
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);

const icons = page.locator('.engagement-card__icon');
const count = await icons.count();
console.log(`Found ${count} engagement-card__icon`);

const first = icons.first();
await first.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
await page.waitForTimeout(400);

const box = await first.boundingBox();
const pad = 16;
await page.screenshot({
  path: join(OUT, 'engagement-icon-after.png'),
  clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 },
});
console.log('Wrote engagement-icon-after.png');
await browser.close();
