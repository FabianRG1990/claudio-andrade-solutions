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
await page.waitForTimeout(1500);

const card = page.locator('.product-card.is-active').first();
await card.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
await page.waitForTimeout(500);

const box = await card.boundingBox();
const size = 90;
await page.screenshot({
  path: join(OUT, 'corner-fix-tl.png'),
  clip: { x: box.x, y: box.y, width: size, height: size },
});
console.log('Wrote corner-fix-tl.png');

await page.screenshot({
  path: join(OUT, 'corner-fix-tr.png'),
  clip: { x: box.x + box.width - size, y: box.y, width: size, height: size },
});
console.log('Wrote corner-fix-tr.png');

await page.screenshot({
  path: join(OUT, 'corner-fix-bl.png'),
  clip: { x: box.x, y: box.y + box.height - size, width: size, height: size },
});
console.log('Wrote corner-fix-bl.png');

await browser.close();
