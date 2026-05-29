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
  viewport: { width: 1440, height: 1200 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await ctx.newPage();

await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Scroll so the cards (not the heading) are centered
const cardsTop = await page.evaluate(() => {
  const grid = document.querySelector('.engagements__grid');
  return grid ? grid.getBoundingClientRect().top + window.scrollY : 0;
});
await page.evaluate(
  (y) => window.scrollTo({ top: y - 40, behavior: 'instant' }),
  cardsTop,
);
await page.waitForTimeout(1200);

await page.screenshot({
  path: join(OUT, 'engagements-cards-full.png'),
  fullPage: false,
});
console.log('Wrote engagements-cards-full.png');

// Card height parity check
const heights = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.engagement-card')).map((c) => ({
    name: c.querySelector('.engagement-card__name')?.textContent?.trim(),
    height: c.getBoundingClientRect().height,
  }));
});
console.log('Card heights:', JSON.stringify(heights, null, 2));

await browser.close();
