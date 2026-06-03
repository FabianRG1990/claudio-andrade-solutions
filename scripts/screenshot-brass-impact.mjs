// Snapshot the home page sections that use --brass so the new #FFD24A token
// can be reviewed across the site (eyebrows, badges, headings, scarcity).

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

const sections = [
  { sel: '.engagement-card--highlight', name: 'engagements-highlight' },
  { sel: '.services-marquee', name: 'services-marquee' },
  { sel: '.timeline', name: 'timeline' },
  { sel: '.case-studies', name: 'case-studies' },
  { sel: '.availability', name: 'availability' },
];

for (const { sel, name } of sections) {
  const el = await page.$(sel);
  if (!el) {
    console.log(`miss: ${sel}`);
    continue;
  }
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await el.boundingBox();
  if (!box) continue;
  const path = `${outDir}/brass-${name}-${stamp}.png`;
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, Math.round(box.x - 8)),
      y: Math.max(0, Math.round(box.y - 8)),
      width: Math.min(1440, Math.round(box.width + 16)),
      height: Math.min(900, Math.round(box.height + 16)),
    },
  });
  console.log(`ok ${name} → ${path}`);
}

await browser.close();
