// Reproduce el caso reportado: scroll lento a cap-03 y capturar tras el
// reveal animation. El ícono debe quedar centrado VERTICALMENTE con el pill.
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'cap3-align');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

// Jump-scroll a posición justo antes de cap-03
const cap3Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-03"]');
  return c.getBoundingClientRect().top + window.scrollY - 450;
});
console.log('cap-03 target scroll Y:', cap3Y);

console.log('Jumping to cap-03 area...');
await page.evaluate((y) => window.scrollTo(0, y), cap3Y);

// Wait long enough for swim (1500ms) + reveal animation (400ms) + buffer
await page.waitForTimeout(3000);

// Capture eyebrow + icon in viewport
const align = await page.evaluate(() => {
  const cap3 = document.querySelector('[appCompanionDock="cap-03"]');
  const pivot = document.querySelector('.companion__pivot');
  const hub = document.querySelector('app-whatsapp-hub .whatsapp-hub__trigger');
  if (!cap3 || !pivot) return null;
  const cap3R = cap3.getBoundingClientRect();
  const pivotR = pivot.getBoundingClientRect();
  const hubR = hub ? hub.getBoundingClientRect() : null;
  return {
    cap3: { top: cap3R.top, bottom: cap3R.bottom, centerY: cap3R.top + cap3R.height / 2 },
    pivot: { top: pivotR.top, bottom: pivotR.bottom, centerY: pivotR.top + pivotR.height / 2 },
    hub: hubR ? { top: hubR.top, bottom: hubR.bottom, centerY: hubR.top + hubR.height / 2 } : null,
    transform: getComputedStyle(pivot).transform,
  };
});
console.log('Alignment data:', JSON.stringify(align, null, 2));

const dockBox = await page.locator('[appCompanionDock="cap-03"]').boundingBox();
if (dockBox) {
  await page.screenshot({
    path: resolve(outDir, 'cap3-zoom.png'),
    clip: {
      x: Math.max(0, dockBox.x - 40),
      y: Math.max(0, dockBox.y - 40),
      width: 600,
      height: 120,
    },
  });
}

await browser.close();
console.log('Screenshot saved.');
