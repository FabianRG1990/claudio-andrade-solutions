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
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);

const grid = page.locator('.featured-products__grid');
await grid.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
await page.waitForTimeout(400);

const cards = page.locator('.product-card');
const target = cards.nth(2);
await target.hover();
await page.waitForTimeout(900);

const box = await grid.boundingBox();
await page.screenshot({
  path: join(OUT, 'accordion-hover-card2.png'),
  clip: { x: box.x, y: box.y, width: box.width, height: box.height },
});
console.log('Wrote accordion-hover-card2.png');

const target4 = cards.nth(4);
await target4.hover();
await page.waitForTimeout(900);
await page.screenshot({
  path: join(OUT, 'accordion-hover-card4.png'),
  clip: { x: box.x, y: box.y, width: box.width, height: box.height },
});
console.log('Wrote accordion-hover-card4.png');

await browser.close();
