import { chromium } from 'playwright';

const browser = await chromium.launch();

async function check(label, ctxOptions, action) {
  const ctx = await browser.newContext(ctxOptions);
  const page = await ctx.newPage();
  await page.goto('http://localhost:4200/', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(1200);
  const top = await page.evaluate(() => {
    const sec = document.querySelector('.featured-products');
    return sec ? sec.getBoundingClientRect().top + window.scrollY : 0;
  });
  await page.evaluate(
    (y) => window.scrollTo({ top: y - 20, behavior: 'instant' }),
    top,
  );
  await page.waitForTimeout(600);
  const result = await action(page);
  console.log(`[${label}]`, result);
  await ctx.close();
}

// Desktop hover: mouseenter on card 2 should activate
await check(
  'desktop-hover',
  {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  },
  async (page) => {
    const cards = page.locator('.product-card');
    await cards.nth(2).hover();
    await page.waitForTimeout(800);
    const active2 = await cards
      .nth(2)
      .evaluate((el) => el.classList.contains('is-active'));
    return { hover_card2_active: active2 };
  },
);

// Mobile portrait: tap should navigate (no accordion)
await check(
  'mobile-portrait',
  {
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  },
  async (page) => {
    const cards = page.locator('.product-card');
    const before = page.url();
    await cards.nth(1).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await cards.nth(1).tap();
    await page.waitForTimeout(1200);
    return { initial: before, after_tap: page.url() };
  },
);

// Mobile landscape: first tap expands, second navigates (already covered)
await check(
  'mobile-landscape',
  {
    viewport: { width: 852, height: 393 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  },
  async (page) => {
    const cards = page.locator('.product-card');
    const before = page.url();
    await cards.nth(2).tap();
    await page.waitForTimeout(800);
    const urlAfter1 = page.url();
    const active2 = await cards
      .nth(2)
      .evaluate((el) => el.classList.contains('is-active'));
    return {
      first_tap_navigated: urlAfter1 !== before,
      card2_active: active2,
    };
  },
);

await browser.close();
