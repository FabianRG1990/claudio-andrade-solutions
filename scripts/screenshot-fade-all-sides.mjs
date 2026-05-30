// Full-section screenshots covering all 4 edges of the head+grid zones to
// verify the 4-side fade (top/bottom/left/right) renders smoothly and no
// hard corners remain.

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

// Full section captures — show both side fades, top fade of head, bottom
// fade of grid all in one frame so we can verify corners are soft.
async function shootSection(headSel, gridSel, name) {
  const head = await page.$(headSel);
  const grid = await page.$(gridSel);
  if (!head || !grid) {
    console.log(`miss ${name}`);
    return;
  }
  await head.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const hb = await head.boundingBox();
  const gb = await grid.boundingBox();
  const y = Math.max(0, Math.round(hb.y - 40));
  const height = Math.min(900, Math.round((gb.y + gb.height + 40) - y));
  const path = `${outDir}/full-${name}-${stamp}.png`;
  await page.screenshot({
    path,
    clip: { x: 0, y, width: 1440, height },
  });
  console.log(`ok ${name} → ${path}`);
}

await shootSection('.featured-products__head', '.featured-products__grid', 'featured');
await shootSection('.engagements__head', '.engagements__grid', 'engagements');

await browser.close();
