import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
const page = await ctx.newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const result = await page.evaluate(() => {
  const card = document.querySelector('.engagement-card__inner');
  if (!card) return 'no card';
  const cs = getComputedStyle(card);
  const ancestors = [];
  let el = card.parentElement;
  while (el && el !== document.body) {
    const acs = getComputedStyle(el);
    ancestors.push({
      tag: el.tagName + (el.className ? '.' + el.className.toString().split(' ')[0] : ''),
      overflow: acs.overflow,
      isolation: acs.isolation,
      contain: acs.contain,
    });
    el = el.parentElement;
  }
  return {
    boxShadow: cs.boxShadow.substring(0, 350),
    overflow: cs.overflow,
    isolation: cs.isolation,
    ancestors: ancestors.slice(0, 6),
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
