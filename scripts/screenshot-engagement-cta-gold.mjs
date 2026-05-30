// Capture the highlight middle pricing card's gold CTA in rest and hover.
// Verifies the new linear-gradient(90deg, ...) background + #F7E394 border.

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

page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const cta = await page.$('.engagement-card__cta--highlight');
if (!cta) {
  console.log('MISS: highlight CTA not found');
  await browser.close();
  process.exit(1);
}
await cta.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);

const box = await cta.boundingBox();
const clip = {
  x: Math.max(0, Math.round(box.x - 24)),
  y: Math.max(0, Math.round(box.y - 24)),
  width: Math.round(box.width + 48),
  height: Math.round(box.height + 48),
};

const restPath = `${outDir}/engagement-cta-gold-${stamp}-rest.png`;
await page.screenshot({ path: restPath, clip });
console.log(`OK rest → ${restPath}`);

await cta.hover();
await page.waitForTimeout(400);
const hoverPath = `${outDir}/engagement-cta-gold-${stamp}-hover.png`;
await page.screenshot({ path: hoverPath, clip });
console.log(`OK hover → ${hoverPath}`);

// Also capture full card middle for context.
const card = await page.$('.engagement-card--highlight');
if (card) {
  const cbox = await card.boundingBox();
  const cardPath = `${outDir}/engagement-cta-gold-${stamp}-card.png`;
  await page.screenshot({
    path: cardPath,
    clip: {
      x: Math.max(0, Math.round(cbox.x - 16)),
      y: Math.max(0, Math.round(cbox.y - 16)),
      width: Math.round(cbox.width + 32),
      height: Math.round(cbox.height + 32),
    },
  });
  console.log(`OK card → ${cardPath}`);
}

await browser.close();
