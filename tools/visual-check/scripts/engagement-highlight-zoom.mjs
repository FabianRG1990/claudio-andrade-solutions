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

const scarcity = page.locator('.engagement-card__scarcity').first();
await scarcity.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
await page.waitForTimeout(400);

const sbox = await scarcity.boundingBox();
const pad = 12;
await page.screenshot({
  path: join(OUT, 'scarcity-gradient.png'),
  clip: { x: sbox.x - pad, y: sbox.y - pad, width: sbox.width + pad * 2, height: sbox.height + pad * 2 },
});
console.log('Wrote scarcity-gradient.png');

const cta = page.locator('.engagement-card__cta--highlight').first();
const cbox = await cta.boundingBox();
await page.screenshot({
  path: join(OUT, 'highlight-cta-1px.png'),
  clip: { x: cbox.x - pad, y: cbox.y - pad, width: cbox.width + pad * 2, height: cbox.height + pad * 2 },
});
console.log('Wrote highlight-cta-1px.png');

await browser.close();
