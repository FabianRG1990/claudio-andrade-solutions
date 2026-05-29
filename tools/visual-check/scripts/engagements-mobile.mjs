import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'iterations');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

// Find the engagements section's absolute page position
const sectionBox = await page.evaluate(() => {
  const sec = document.querySelector('.engagements, section:has(.engagement-card)');
  if (!sec) return null;
  const rect = sec.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    bottom: rect.bottom + window.scrollY,
    height: rect.height,
  };
});

if (!sectionBox) {
  console.log('Section not found');
  await browser.close();
  process.exit(1);
}

console.log('Section absolute top:', sectionBox.top, 'height:', sectionBox.height);

const viewportH = 852;
const chunks = Math.ceil(sectionBox.height / (viewportH * 0.9));
for (let i = 0; i < chunks; i++) {
  const targetY = sectionBox.top + i * (viewportH * 0.9) - 80;
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), Math.max(0, targetY));
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(OUT, `engagements-mobile-chunk-${i + 1}.png`),
    fullPage: false,
  });
  console.log(`Wrote engagements-mobile-chunk-${i + 1}.png at scrollY=${Math.max(0, targetY)}`);
}

await browser.close();
