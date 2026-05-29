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

const samples = [
  { selector: '.program-card', name: 'program-card' },
  { selector: '.case-row__media', name: 'case-row-media' },
];

for (const { selector, name } of samples) {
  const el = page.locator(selector).first();
  const exists = (await el.count()) > 0;
  if (!exists) {
    console.log(`SKIP: ${selector} not found`);
    continue;
  }
  await el.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(500);
  const box = await el.boundingBox();
  if (!box) continue;
  const size = 90;
  await page.screenshot({
    path: join(OUT, `corner-${name}-tl.png`),
    clip: { x: box.x, y: box.y, width: size, height: size },
  });
  console.log(`Wrote corner-${name}-tl.png`);
}

await browser.close();
