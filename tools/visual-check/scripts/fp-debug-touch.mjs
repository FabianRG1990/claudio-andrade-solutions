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
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

const mq = await page.evaluate(() => ({
  hoverNone: window.matchMedia('(hover: none)').matches,
  hoverHover: window.matchMedia('(hover: hover)').matches,
  anyHoverNone: window.matchMedia('(any-hover: none)').matches,
  pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
  minW768: window.matchMedia('(min-width: 768px)').matches,
  combined: window.matchMedia('(hover: none) and (min-width: 768px)').matches,
  innerW: window.innerWidth,
  ua: navigator.userAgent,
  maxTouch: navigator.maxTouchPoints,
}));
console.log(JSON.stringify(mq, null, 2));

// Check the click handler is wired
const hasHandler = await page.evaluate(() => {
  const card = document.querySelector('.product-card');
  if (!card) return 'no card';
  // Check if Angular event binding emit
  return {
    classList: Array.from(card.classList),
    href: card.getAttribute('href'),
    routerLink: card.getAttribute('ng-reflect-router-link'),
  };
});
console.log('Card state:', JSON.stringify(hasHandler, null, 2));

await browser.close();
