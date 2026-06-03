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

page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[browser error]', m.text());
});

await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Diagnostic
const info = await page.evaluate(() => {
  const sec = document.querySelector('.engagements');
  return {
    found: !!sec,
    top: sec ? sec.getBoundingClientRect().top + window.scrollY : null,
    bodyHeight: document.body.scrollHeight,
    cardCount: document.querySelectorAll('.engagement-card').length,
  };
});
console.log('Diagnostic:', JSON.stringify(info, null, 2));

if (info.found && info.top != null) {
  await page.evaluate(
    (y) => window.scrollTo({ top: y - 60, behavior: 'instant' }),
    info.top,
  );
  await page.waitForTimeout(1200);

  await page.screenshot({
    path: join(OUT, 'engagements-new-desktop.png'),
    fullPage: false,
  });
  console.log('Wrote engagements-new-desktop.png');

  // Full section capture
  const sectionHeight = await page.evaluate(() => {
    const sec = document.querySelector('.engagements');
    return sec.getBoundingClientRect().height;
  });
  console.log('Section height:', sectionHeight);
}

await browser.close();
