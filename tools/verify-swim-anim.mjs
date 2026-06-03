// Captura una secuencia de frames durante UN swim para verificar:
//  (a) el path es recto (no media-luna)
//  (b) el cuerpo del pez oscila visiblemente (no rígido)
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'swim-anim');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

// Scroll target: cap-02 entering viewport from bottom so swim triggers
const cap2Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  return c.getBoundingClientRect().top + window.scrollY - 850;
});

console.log('Triggering swim — capturing frames every 150ms during swim');
await page.evaluate((y) => window.scrollTo(0, y), cap2Y);

// Swim arranca ~497ms después del scroll, dura 1500ms.
// Captura 8 frames espaciados durante el swim entero.
await page.waitForTimeout(550); // wait for swim start

for (let i = 0; i < 10; i++) {
  await page.screenshot({
    path: resolve(outDir, `t${String(i * 150).padStart(4, '0')}ms.jpg`),
    type: 'jpeg',
    quality: 80,
  });
  await page.waitForTimeout(150);
}

await browser.close();
console.log('Done. Frames in:', outDir);
