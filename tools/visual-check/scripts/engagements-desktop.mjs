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
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);

const top = await page.evaluate(() => {
  const sec = document.querySelector('.engagements');
  return sec ? sec.getBoundingClientRect().top + window.scrollY : 0;
});
await page.evaluate((y) => window.scrollTo({ top: y - 60, behavior: 'instant' }), top);
await page.waitForTimeout(700);

await page.screenshot({
  path: join(OUT, 'engagements-desktop.png'),
  fullPage: false,
});
console.log('Wrote engagements-desktop.png');

await browser.close();
