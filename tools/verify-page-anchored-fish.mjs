// Verifica que el pez del swim VIVE en coords de PÁGINA (no viewport):
//   1. Iniciar en el hero
//   2. Scroll hasta cap-02 → dispara debounce → arranca el swim
//   3. Durante el swim, hacer scroll EXTRA más abajo
//   4. Tomar screenshots durante y verificar:
//      - El pez aparece y desaparece naturalmente del viewport según scroll
//      - NO sigue al usuario (no permanece en pantalla cuando user scrollea más)
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'page-anchored');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

// Hook into companion to log fish position each frame in PAGE coords
await page.evaluate(() => {
  window.__fishLog = [];
  // Watch transform changes on the companion canvas
  const canvas = document.querySelector('.companion__fish-canvas');
  if (!canvas) return;
  // We can't easily intercept the renderer, so instead we'll capture scrollY
  // at known intervals via setInterval, plus the canvas's actual pixel content
});

// Locate cap-02 absolute Y
const cap2Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  if (!c) return null;
  return c.getBoundingClientRect().top + window.scrollY - 450;
});
console.log('cap-02 target scroll Y:', cap2Y);

// Step 1: Jump-scroll to a position just above cap-02 — active dock will
// become cap-02. After 250ms debounce, swim starts.
console.log('\n[STEP 1] Jump to position before cap-02');
await page.evaluate((y) => window.scrollTo(0, y), cap2Y);
await page.waitForTimeout(50); // tiny wait so active dock detection fires
await page.screenshot({ path: resolve(outDir, '01-pre-swim.jpg'), type: 'jpeg', quality: 70 });

// Step 2: Wait for debounce (250ms) + capture mid-swim
console.log('[STEP 2] Wait for debounce + capture mid-swim');
await page.waitForTimeout(400); // debounce done, ~150ms into swim
await page.screenshot({ path: resolve(outDir, '02-mid-swim-stationary.jpg'), type: 'jpeg', quality: 70 });

// Step 3: Now scroll EXTRA way down (page-anchored fish should disappear from viewport)
console.log('[STEP 3] Extra scroll DURING swim');
await page.evaluate(() => window.scrollBy(0, 800));
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(outDir, '03-during-swim-scrolled-down.jpg'), type: 'jpeg', quality: 70 });

// Step 4: Capture again at the end of swim duration
await page.waitForTimeout(700);
await page.screenshot({ path: resolve(outDir, '04-after-swim-end.jpg'), type: 'jpeg', quality: 70 });

// Step 5: Scroll back to cap-02 — fish should now be settled icon
await page.waitForTimeout(500);
await page.evaluate((y) => window.scrollTo(0, y + 100), cap2Y);
await page.waitForTimeout(2000); // settle
await page.screenshot({ path: resolve(outDir, '05-back-to-cap2.jpg'), type: 'jpeg', quality: 70 });

await browser.close();
console.log('\nScreenshots saved to:', outDir);
