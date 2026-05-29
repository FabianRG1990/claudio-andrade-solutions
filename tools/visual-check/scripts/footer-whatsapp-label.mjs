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
await page.waitForTimeout(1500);

const hub = page.locator('.footer__whatsapp-hub').first();
const exists = (await hub.count()) > 0;
if (!exists) {
  console.log('SKIP: .footer__whatsapp-hub not found');
  await browser.close();
  process.exit(0);
}
await hub.evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
await page.waitForTimeout(500);

const box = await hub.boundingBox();
if (!box) {
  console.log('No bounding box for hub');
  await browser.close();
  process.exit(0);
}

// Capture a generous region around the trigger to see the label below
const pad = 80;
await page.screenshot({
  path: join(OUT, 'footer-whatsapp-label-default.png'),
  clip: {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad / 2),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  },
});
console.log('Wrote footer-whatsapp-label-default.png');

// Hover state
await hub.hover();
await page.waitForTimeout(400);
await page.screenshot({
  path: join(OUT, 'footer-whatsapp-label-hover.png'),
  clip: {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad / 2),
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  },
});
console.log('Wrote footer-whatsapp-label-hover.png');

await browser.close();
