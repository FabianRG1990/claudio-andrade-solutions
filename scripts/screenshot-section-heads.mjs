// Snapshot the two section heads that got background:#06091b applied
// (featured-products + engagements) so we can verify the result.

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

for (const sel of ['.featured-products__head', '.engagements__head']) {
  const el = await page.$(sel);
  if (!el) {
    console.log(`miss ${sel}`);
    continue;
  }
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await el.boundingBox();
  if (!box) continue;
  const path = `${outDir}/head-${sel.replace(/[.\s]/g, '_')}-${stamp}.png`;
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, Math.round(box.x - 16)),
      y: Math.max(0, Math.round(box.y - 16)),
      width: Math.min(1440, Math.round(box.width + 32)),
      height: Math.min(900, Math.round(box.height + 32)),
    },
  });
  console.log(`ok ${sel} → ${path}`);
}

await browser.close();
