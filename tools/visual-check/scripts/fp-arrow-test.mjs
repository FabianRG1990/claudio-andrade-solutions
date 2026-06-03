import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'iterations');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

// === Desktop: arrow visible and navigates ===
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const top = await page.evaluate(() => {
    const sec = document.querySelector('.featured-products');
    return sec ? sec.getBoundingClientRect().top + window.scrollY : 0;
  });
  await page.evaluate((y) => window.scrollTo({ top: y - 20, behavior: 'instant' }), top);
  await page.waitForTimeout(500);

  await page.screenshot({ path: join(OUT, 'arrow-desktop.png') });

  // Click on arrow of first card
  const arrows = page.locator('.product-card__arrow');
  const arrowCount = await arrows.count();
  console.log('[desktop] arrow count:', arrowCount);
  await arrows.first().click();
  await page.waitForTimeout(1000);
  console.log('[desktop] URL after arrow click:', page.url());
  await ctx.close();
}

// === Mobile portrait: arrow visible and navigates ===
{
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
  const top = await page.evaluate(() => {
    const sec = document.querySelector('.featured-products');
    return sec ? sec.getBoundingClientRect().top + window.scrollY : 0;
  });
  await page.evaluate((y) => window.scrollTo({ top: y - 20, behavior: 'instant' }), top);
  await page.waitForTimeout(500);

  await page.screenshot({
    path: join(OUT, 'arrow-mobile-portrait.png'),
    fullPage: false,
  });

  const arrows = page.locator('.product-card__arrow');
  const arrowCount = await arrows.count();
  const firstArrowVisible = await arrows.first().isVisible();
  console.log('[mobile-portrait] arrow count:', arrowCount, 'visible:', firstArrowVisible);

  // Tap on card (NOT arrow) — should NOT navigate
  const initial = page.url();
  await page.locator('.product-card').first().tap();
  await page.waitForTimeout(800);
  console.log('[mobile-portrait] URL after CARD tap:', page.url(), 'changed:', page.url() !== initial);

  // Tap on arrow — should navigate
  await arrows.first().tap();
  await page.waitForTimeout(1000);
  console.log('[mobile-portrait] URL after ARROW tap:', page.url());
  await ctx.close();
}

// === Mobile landscape ===
{
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
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const top = await page.evaluate(() => {
    const sec = document.querySelector('.featured-products');
    return sec ? sec.getBoundingClientRect().top + window.scrollY : 0;
  });
  await page.evaluate((y) => window.scrollTo({ top: y - 20, behavior: 'instant' }), top);
  await page.waitForTimeout(500);

  await page.screenshot({ path: join(OUT, 'arrow-mobile-landscape.png') });
  console.log('[mobile-landscape] screenshot saved');
  await ctx.close();
}

await browser.close();
