// Capture the featured-products bento grid with the new product images
// so we can verify each card renders the correct image at native AR
// without zoom/crop.

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
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);  // give imgs time to load

const grid = await page.$('.featured-products__grid');
await grid.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);

const gb = await grid.boundingBox();
const path = `${outDir}/featured-bento-${stamp}.png`;
await page.screenshot({
  path,
  clip: {
    x: 0,
    y: Math.max(0, Math.round(gb.y - 20)),
    width: 1440,
    height: Math.min(900, Math.round(gb.height + 40)),
  },
});
console.log(`OK → ${path}`);

await browser.close();
