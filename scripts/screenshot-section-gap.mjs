// Capture the join between section __head and section __grid for
// engagements + featured-products to verify #06091b paints continuously
// through what was previously the margin gap.

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
await page.waitForTimeout(1500);

const pairs = [
  { head: '.engagements__head', grid: '.engagements__grid', name: 'engagements' },
  { head: '.featured-products__head', grid: '.featured-products__grid', name: 'featured-products' },
];

for (const { head, grid, name } of pairs) {
  const h = await page.$(head);
  const g = await page.$(grid);
  if (!h || !g) {
    console.log(`miss ${name}`);
    continue;
  }
  await h.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const hb = await h.boundingBox();
  const gb = await g.boundingBox();
  const y = Math.max(0, Math.round(hb.y - 16));
  const height = Math.min(900, Math.round((gb.y + 160) - y));
  const path = `${outDir}/gap-${name}-${stamp}.png`;
  await page.screenshot({
    path,
    clip: { x: 0, y, width: 1440, height },
  });
  console.log(`ok ${name} → ${path}`);
}

await browser.close();
