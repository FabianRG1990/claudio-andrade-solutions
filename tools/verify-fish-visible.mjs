// Verifica que el pez SE VEA durante el swim.
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'fish-visible');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

// Capture state of swim by polling fish position
await page.evaluate(() => {
  window.__samples = [];
  // Hook: log swim state changes (we'll grab them after)
});

// Find cap-02 (in DOM as attribute) and scroll close to it.
const cap2Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  return c.getBoundingClientRect().top + window.scrollY - 850; // viewport at bottom
});

console.log('Triggering scroll to:', cap2Y);
await page.evaluate((y) => window.scrollTo(0, y), cap2Y);

// Sample multiple frames during the swim
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(150);
  const state = await page.evaluate(() => {
    const canvas = document.querySelector('.companion__fish-canvas');
    const pivot = document.querySelector('.companion__pivot');
    // Get canvas size + check if it has any pixel content (rough heuristic)
    const isSwimming = pivot?.classList.contains('is-swimming');
    const pivotTransform = pivot ? getComputedStyle(pivot).transform : '';
    const hub = pivot?.querySelector('.whatsapp-hub__trigger');
    const hubOpacity = hub ? getComputedStyle(hub).opacity : '';
    return {
      scrollY: window.scrollY,
      isSwimming,
      pivotTransform: pivotTransform.replace(/matrix\(/, '').replace(/\).*/, '').split(',').map(s => parseFloat(s.trim()).toFixed(0)).join(','),
      hubOpacity,
    };
  });
  console.log(`[${i}] sY=${Math.round(state.scrollY)} swim=${state.isSwimming} hub-op=${state.hubOpacity} pivot=(${state.pivotTransform})`);
  if (i % 3 === 0) {
    await page.screenshot({
      path: resolve(outDir, `frame-${String(i).padStart(2, '0')}.jpg`),
      type: 'jpeg', quality: 70,
    });
  }
}

await browser.close();
