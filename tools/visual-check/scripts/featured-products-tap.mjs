import { chromium, devices } from 'playwright';
import { mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'iterations');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

// Mobile landscape: 852x393 (iPhone 14 Pro rotated). Touch device, no hover.
const ctx = await browser.newContext({
  viewport: { width: 852, height: 393 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
const page = await ctx.newPage();

await page.goto('http://localhost:4200/', {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

// Scroll to featured-products
const top = await page.evaluate(() => {
  const sec = document.querySelector('.featured-products');
  return sec ? sec.getBoundingClientRect().top + window.scrollY : 0;
});
await page.evaluate(
  (y) => window.scrollTo({ top: y - 20, behavior: 'instant' }),
  top,
);
await page.waitForTimeout(800);

await page.screenshot({
  path: join(OUT, 'fp-landscape-01-before.png'),
  fullPage: false,
});
console.log('Wrote fp-landscape-01-before.png (state before any tap)');

// Tap an inactive card (index 3 — fourth card)
const cards = page.locator('.product-card');
const cardCount = await cards.count();
console.log(`Found ${cardCount} cards`);

const initialUrl = page.url();
const targetIdx = 3;

// First tap on inactive card — should expand, NOT navigate
await cards.nth(targetIdx).tap();
await page.waitForTimeout(900); // wait for accordion transition

const urlAfterFirstTap = page.url();
const isActiveAfterFirst = await cards
  .nth(targetIdx)
  .evaluate((el) => el.classList.contains('is-active'));

console.log(`After first tap on card ${targetIdx}:`);
console.log(`  URL changed: ${urlAfterFirstTap !== initialUrl}`);
console.log(`  Card is-active: ${isActiveAfterFirst}`);

await page.screenshot({
  path: join(OUT, 'fp-landscape-02-after-first-tap.png'),
  fullPage: false,
});
console.log('Wrote fp-landscape-02-after-first-tap.png');

// Second tap on the same (now active) card — should navigate
if (urlAfterFirstTap === initialUrl) {
  await cards.nth(targetIdx).tap();
  await page.waitForTimeout(1500);
  const urlAfterSecondTap = page.url();
  console.log(`After second tap on same card:`);
  console.log(`  URL: ${urlAfterSecondTap}`);
  console.log(`  Navigated: ${urlAfterSecondTap !== initialUrl}`);
} else {
  console.log('UNEXPECTED: navigated on first tap — interceptor not working');
}

await browser.close();
