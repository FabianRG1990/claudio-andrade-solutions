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
await page.waitForTimeout(1200);

// Scroll to featured products so the rotation effect is visible on a card section
const top = await page.evaluate(() => {
  const sec = document.querySelector('.featured-products');
  return sec ? sec.getBoundingClientRect().top + window.scrollY : 0;
});
await page.evaluate((y) => window.scrollTo({ top: y - 20, behavior: 'instant' }), top);
await page.waitForTimeout(400);

// Pre-rotation
await page.screenshot({ path: join(OUT, 'rot-A-portrait.png') });

// Rotate
await page.setViewportSize({ width: 852, height: 393 });

// Capture during veil peak (~30ms after rotation)
await page.waitForTimeout(30);
await page.screenshot({ path: join(OUT, 'rot-B-veil-peak.png') });

// Capture mid-fade (~200ms — should be ~0.27 opacity since 90ms hold + 110ms of 320ms fade)
await page.waitForTimeout(170);
await page.screenshot({ path: join(OUT, 'rot-C-mid-fade.png') });

// Capture after fade complete (~500ms)
await page.waitForTimeout(400);
await page.screenshot({ path: join(OUT, 'rot-D-landscape.png') });

await browser.close();
console.log('Wrote rot-A through rot-D');
