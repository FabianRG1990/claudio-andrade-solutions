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
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
const page = await ctx.newPage();

await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const top = await page.evaluate(() => {
  const sec = document.querySelector('.featured-products');
  return sec ? sec.getBoundingClientRect().top + window.scrollY : 0;
});
await page.evaluate((y) => window.scrollTo({ top: y - 20, behavior: 'instant' }), top);
await page.waitForTimeout(400);

// Force veil active and verify rendering
await page.evaluate(() => {
  const v = document.querySelector('.rotation-veil');
  if (v) v.classList.add('is-active');
});
await page.waitForTimeout(150);
await page.screenshot({ path: join(OUT, 'veil-forced-active.png') });

// Remove and capture mid-fade
await page.evaluate(() => {
  const v = document.querySelector('.rotation-veil');
  if (v) v.classList.remove('is-active');
});
await page.waitForTimeout(160);
await page.screenshot({ path: join(OUT, 'veil-mid-fade.png') });

await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, 'veil-after-fade.png') });

await browser.close();
console.log('done');
