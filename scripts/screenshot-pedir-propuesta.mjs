// Verify 'Pedir propuesta' now opens the WhatsApp Hub popover on /productos.
// Captures: (a) the CTA at rest, (b) the popover after click.

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = 'http://localhost:4200';
const outDir = 'scripts/_screenshots';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') console.log(`[console.error] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`${base}/productos`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const allCta = await page.$$('.product-row__cta');
console.log(`Found ${allCta.length} .product-row__cta`);
const allHubs = await page.$$('app-whatsapp-hub');
console.log(`Found ${allHubs.length} app-whatsapp-hub`);

const cta = await page.$('button.product-row__cta');
if (!cta) {
  console.log('MISS: no CTA found');
  await browser.close();
  process.exit(1);
}
await cta.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);

// Capture region around the CTA (300px above to see popover when open).
const box = await cta.boundingBox();
const clip = {
  x: Math.max(0, box.x - 320),
  y: Math.max(0, box.y - 340),
  width: Math.min(720, 1440 - Math.max(0, box.x - 320)),
  height: Math.min(440, 900 - Math.max(0, box.y - 340)),
};

const restPath = `${outDir}/pedir-${stamp}-rest.png`;
await page.screenshot({ path: restPath, clip });
console.log(`OK rest → ${restPath}`);

await cta.click();
await page.waitForTimeout(500);

const openPath = `${outDir}/pedir-${stamp}-open.png`;
await page.screenshot({ path: openPath, clip });
console.log(`OK open → ${openPath}`);

await browser.close();
