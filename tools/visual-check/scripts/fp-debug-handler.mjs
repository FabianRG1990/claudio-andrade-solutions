import { chromium } from 'playwright';

const browser = await chromium.launch();
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

page.on('console', (msg) => console.log('[browser]', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('[pageerror]', err.message));

await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// Check what's on the card
const cardInfo = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.product-card'));
  return cards.map((c, i) => ({
    i,
    tag: c.tagName,
    href: c.getAttribute('href'),
    routerLink: c.getAttribute('ng-reflect-router-link'),
    classes: Array.from(c.classList),
  }));
});
console.log('Cards before tap:', JSON.stringify(cardInfo, null, 2));

// Hook into navigation
let navigated = false;
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) {
    console.log('[nav]', frame.url());
    navigated = true;
  }
});

// Inject capture-phase click logger BEFORE tapping
await page.evaluate(() => {
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target;
      const card = t.closest('.product-card');
      console.log(
        '[capture-click]',
        'defaultPrevented:',
        e.defaultPrevented,
        'card-idx:',
        card
          ? Array.from(document.querySelectorAll('.product-card')).indexOf(card)
          : null,
      );
    },
    true,
  );
  document.addEventListener('click', (e) => {
    console.log('[bubble-click]', 'defaultPrevented:', e.defaultPrevented);
  });
});

const cards = page.locator('.product-card');
await cards.nth(3).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);

console.log('--- tapping card 3 ---');
await cards.nth(3).tap();
await page.waitForTimeout(1500);

console.log('Navigated?', navigated, 'URL:', page.url());

await browser.close();
