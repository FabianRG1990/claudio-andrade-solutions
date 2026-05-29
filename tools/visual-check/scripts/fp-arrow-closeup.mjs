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
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const top = await page.evaluate(() => {
  const sec = document.querySelector('.featured-products__grid');
  return sec ? sec.getBoundingClientRect().top + window.scrollY : 0;
});
await page.evaluate((y) => window.scrollTo({ top: y - 80, behavior: 'instant' }), top);
await page.waitForTimeout(500);

// Get arrow box of first card (active)
const box = await page.locator('.product-card.is-active .product-card__arrow').boundingBox();
console.log('arrow box:', box);

if (box) {
  await page.screenshot({
    path: join(OUT, 'arrow-closeup-default.png'),
    clip: {
      x: Math.max(0, box.x - 40),
      y: Math.max(0, box.y - 40),
      width: box.width + 80,
      height: box.height + 80,
    },
  });
  console.log('Wrote arrow-closeup-default.png');

  // Hover state
  await page.locator('.product-card.is-active .product-card__arrow').hover();
  await page.waitForTimeout(400);
  const box2 = await page.locator('.product-card.is-active .product-card__arrow').boundingBox();
  await page.screenshot({
    path: join(OUT, 'arrow-closeup-hover.png'),
    clip: {
      x: Math.max(0, box2.x - 40),
      y: Math.max(0, box2.y - 40),
      width: box2.width + 80,
      height: box2.height + 80,
    },
  });
  console.log('Wrote arrow-closeup-hover.png');
}

await browser.close();
