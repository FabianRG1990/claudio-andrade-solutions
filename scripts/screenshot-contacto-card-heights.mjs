// Verify the 3 info-cards on /contacto have equal heights at desktop.

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

await page.goto('http://localhost:4200/contacto', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const info = await page.$('.contacto__info');
await info.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);

const heights = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.contacto__info .info-card'));
  return cards.map((el) => ({
    label: el.querySelector('.info-card__label')?.textContent?.trim(),
    height: Math.round(el.getBoundingClientRect().height),
    width: Math.round(el.getBoundingClientRect().width),
  }));
});
console.log('Cards:', JSON.stringify(heights, null, 2));

const path = `${outDir}/heights-${stamp}.png`;
await info.screenshot({ path });
console.log(`Screenshot → ${path}`);

await browser.close();
