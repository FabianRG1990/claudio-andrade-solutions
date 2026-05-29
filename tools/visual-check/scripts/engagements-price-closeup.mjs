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
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await ctx.newPage();

await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2200);

const cardsTop = await page.evaluate(() => {
  const grid = document.querySelector('.engagements__grid');
  return grid ? grid.getBoundingClientRect().top + window.scrollY : 0;
});
await page.evaluate(
  (y) => window.scrollTo({ top: y - 40, behavior: 'instant' }),
  cardsTop,
);
await page.waitForTimeout(800);

// Capture the head + price band of each card
const cards = await page.locator('.engagement-card').all();
for (let i = 0; i < cards.length; i++) {
  const card = cards[i];
  const name = await card.locator('.engagement-card__name').textContent();
  const box = await card.boundingBox();
  if (!box) continue;
  await page.screenshot({
    path: join(OUT, `price-block-${i}-${name.trim().replace(/\s+/g, '_')}.png`),
    clip: {
      x: box.x - 8,
      y: box.y - 8,
      width: box.width + 16,
      height: 280,
    },
  });
  console.log(`Wrote price-block-${i}-${name.trim()}.png`);
}

await browser.close();
