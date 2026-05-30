// Capture the fade edges (top of each __head, bottom of each __grid) so we
// can verify the new vanishing-zone gradient is smooth and matches the
// Hero→Ch1 seam pattern.

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

async function shoot(sel, edge, name) {
  const el = await page.$(sel);
  if (!el) {
    console.log(`miss ${sel}`);
    return;
  }
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const b = await el.boundingBox();
  if (!b) return;
  const y = edge === 'top'
    ? Math.max(0, Math.round(b.y - 60))
    : Math.max(0, Math.round(b.y + b.height - 100));
  const path = `${outDir}/fade-${name}-${edge}-${stamp}.png`;
  await page.screenshot({
    path,
    clip: { x: 0, y, width: 1440, height: 220 },
  });
  console.log(`ok ${name} ${edge} → ${path}`);
}

await shoot('.featured-products__head', 'top', 'featured-head');
await shoot('.featured-products__grid', 'bottom', 'featured-grid');
await shoot('.engagements__head', 'top', 'engagements-head');
await shoot('.engagements__grid', 'bottom', 'engagements-grid');

await browser.close();
