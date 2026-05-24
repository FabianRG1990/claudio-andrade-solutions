// Trace exacto del swim — instrumenta el componente para emitir cada
// frame con (t, posPage, posViewport, scrollY).
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'trace');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

// Instrument the fishRenderer.update method to log each call
await page.evaluate(() => {
  window.__fishUpdates = [];
  // We need to find the companion fish renderer. It's inside an Angular
  // component, not directly accessible. Easier: monkey-patch the canvas's
  // 3d context to track gl.uniform4f calls or similar. But that's hard.
  //
  // Simpler: poll the canvas pixels at known intervals to detect fish presence.
  const canvas = document.querySelector('.companion__fish-canvas');
  if (canvas) {
    window.__companionCanvas = canvas;
  }
});

// Get cap-02 page Y
const cap2Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  return c.getBoundingClientRect().top + window.scrollY - 450;
});

// Jump to position
console.log('Jumping to cap-02 area...');
await page.evaluate((y) => window.scrollTo(0, y), cap2Y);
await page.waitForTimeout(100);

// Capture frames at 200ms intervals for 3 seconds with scrollY annotation
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(200);
  const info = await page.evaluate(() => ({
    scrollY: window.scrollY,
    time: performance.now(),
  }));
  const shot = await page.screenshot({ type: 'jpeg', quality: 70 });
  writeFileSync(resolve(outDir, `t${String(i).padStart(2, '0')}-y${Math.round(info.scrollY)}.jpg`), shot);
  console.log(`[${i}] scrollY=${Math.round(info.scrollY)}`);
}

await browser.close();
console.log('Done');
