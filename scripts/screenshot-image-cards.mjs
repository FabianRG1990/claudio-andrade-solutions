// Verify the halved padding on image cards (product-card, program-card,
// product-row__media, case-row__media). Captures one screenshot per page,
// zoomed into a representative card so the gap between gradient border and
// image is clearly visible.

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

const targets = [
  { url: '/', selector: '.product-card', label: 'product-card' },
  { url: '/', selector: '.case-row__media', label: 'case-row-media' },
  { url: '/productos', selector: '.product-row__media', label: 'product-row-media' },
  { url: '/nosotros', selector: '.program-card', label: 'program-card' },
];

for (const t of targets) {
  await page.goto(base + t.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const el = await page.$(t.selector);
  if (!el) {
    console.log(`MISS ${t.label} on ${t.url}`);
    continue;
  }
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const path = `${outDir}/cards-${stamp}-${t.label}.png`;
  await el.screenshot({ path });
  console.log(`OK ${t.label} → ${path}`);
}

await browser.close();
