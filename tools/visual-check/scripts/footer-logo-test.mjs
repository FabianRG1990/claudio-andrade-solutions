import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
});
const page = await ctx.newPage();

// Start on /productos so navigating to / is observable
await page.goto('http://localhost:4200/productos', {
  waitUntil: 'networkidle',
});
await page.waitForTimeout(1200);

const before = page.url();
console.log('Initial URL:', before);

// Scroll to footer
await page.evaluate(() =>
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }),
);
await page.waitForTimeout(500);

const link = page.locator('.footer__brand-link');
const count = await link.count();
console.log('Footer brand link count:', count);

const visible = await link.first().isVisible();
console.log('Visible:', visible);

await link.first().click();
await page.waitForTimeout(1000);
console.log('URL after click:', page.url());

await browser.close();
