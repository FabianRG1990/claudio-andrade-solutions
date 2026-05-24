// Captura un frame específico durante el swim (cuando el pez debería estar
// visible mid-trajectory).
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'mid-swim');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

const cap2Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  return c.getBoundingClientRect().top + window.scrollY - 850;
});

console.log('Scrolling and capturing screenshots during swim...');
await page.evaluate((y) => window.scrollTo(0, y), cap2Y);

// Swim arranca ~497ms después del scroll. Dura ~1500ms.
// Capturar al t=1000ms (mid-swim, 33%) y t=1500ms (66%)
await page.waitForTimeout(1000);
await page.screenshot({ path: resolve(outDir, '01-mid-swim-1000ms.jpg'), type: 'jpeg', quality: 75 });

await page.waitForTimeout(500);
await page.screenshot({ path: resolve(outDir, '02-mid-swim-1500ms.jpg'), type: 'jpeg', quality: 75 });

await page.waitForTimeout(800);
await page.screenshot({ path: resolve(outDir, '03-after-swim.jpg'), type: 'jpeg', quality: 75 });

await browser.close();
console.log('Done');
