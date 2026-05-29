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
await page.waitForTimeout(2200);

const sizes = await page.evaluate(() => {
  const fp = document.querySelector('.featured-products__cta');
  const cs = document.querySelector('.case-studies__cta');
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      width: Math.round(r.width),
      height: Math.round(r.height),
      padding: cs.padding,
      minHeight: cs.minHeight,
      fontSize: cs.fontSize,
      gap: cs.gap,
      borderRadius: cs.borderRadius,
    };
  };
  return { featured: rect(fp), cases: rect(cs) };
});

console.log(JSON.stringify(sizes, null, 2));

// Screenshot each
const fpCta = page.locator('.featured-products__cta').first();
const csCta = page.locator('.case-studies__cta').first();

await fpCta.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const fpBox = await fpCta.boundingBox();
await page.screenshot({
  path: join(OUT, 'cta-featured-products.png'),
  clip: { x: fpBox.x - 16, y: fpBox.y - 16, width: fpBox.width + 32, height: fpBox.height + 32 },
});

await csCta.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const csBox = await csCta.boundingBox();
await page.screenshot({
  path: join(OUT, 'cta-case-studies.png'),
  clip: { x: csBox.x - 16, y: csBox.y - 16, width: csBox.width + 32, height: csBox.height + 32 },
});

console.log('Wrote cta-featured-products.png, cta-case-studies.png');

await browser.close();
