import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'iterations');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

async function shot(viewport, filename, deviceScaleFactor = 2) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[browser error]', m.text());
  });
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // Scroll para CENTRAR el grid en viewport — así todas las cards entran
  // al rango del appReveal antes del screenshot.
  const center = await page.evaluate(() => {
    const grid = document.querySelector('.featured-products__grid');
    if (!grid) return 0;
    const r = grid.getBoundingClientRect();
    return r.top + window.scrollY + r.height / 2 - window.innerHeight / 2;
  });
  await page.evaluate(
    (y) => window.scrollTo({ top: y, behavior: 'instant' }),
    center,
  );
  await page.waitForTimeout(1600);

  await page.screenshot({
    path: join(OUT, filename),
    fullPage: false,
  });

  const cards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.product-card')).map((c) => {
      const r = c.getBoundingClientRect();
      const img = c.querySelector('.product-card__image');
      const ir = img ? img.getBoundingClientRect() : null;
      return {
        name: c.querySelector('.product-card__title')?.textContent?.trim() || '?',
        width: Math.round(r.width),
        height: Math.round(r.height),
        AR: (r.width / r.height).toFixed(3),
        imgVisible: ir
          ? `${Math.round(ir.width)}x${Math.round(ir.height)}`
          : 'no-img',
      };
    });
  });
  console.log(filename, JSON.stringify(cards, null, 2));
  await ctx.close();
}

await shot({ width: 1440, height: 900 }, 'featured-bento-desktop.png');
await shot({ width: 1024, height: 900 }, 'featured-bento-tablet.png');
await shot({ width: 393, height: 852 }, 'featured-bento-mobile.png');

await browser.close();
