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
await page.goto('http://localhost:4200/acerca-de-nosotros', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

const el = page.locator('.program-card__media').first();
const exists = (await el.count()) > 0;
if (!exists) {
  console.log('SKIP: .program-card__media not found');
  await browser.close();
  process.exit(0);
}
await el.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
await page.waitForTimeout(500);
const box = await el.boundingBox();
if (!box) {
  console.log('No bounding box');
  await browser.close();
  process.exit(0);
}
const size = 90;
await page.screenshot({
  path: join(OUT, 'corner-program-card-tl.png'),
  clip: { x: box.x, y: box.y, width: size, height: size },
});
console.log('Wrote corner-program-card-tl.png');

await browser.close();
