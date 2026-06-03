// Test the popover on the SECOND product row (reverse layout — body on left,
// image on right). The popover is right-aligned to the pill, so we need to
// confirm it doesn't overflow the viewport's left edge.

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

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

await page.goto('http://localhost:4200/productos', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const ctas = await page.$$('button.product-row__cta');
console.log(`Found ${ctas.length} CTAs`);

// Second product (index 1) — has product-row--reverse class.
const cta = ctas[1];
await cta.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await cta.click();
await page.waitForTimeout(500);

const path = `${outDir}/pedir-reversed-${stamp}.png`;
await page.screenshot({ path, fullPage: false });
console.log(`OK reversed-product → ${path}`);

await browser.close();
