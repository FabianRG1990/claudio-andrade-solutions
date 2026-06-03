// Verifica alineamiento del ícono DURANTE scroll activo (no solo después).
// Esto reproduce el caso que el user sigue viendo: scrollear y ver el ícono
// desalineado del eyebrow.
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'scroll-align');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

// Jump to cap-03 area and wait for settle (icon docked at cap-03)
const cap3Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-03"]');
  return c.getBoundingClientRect().top + window.scrollY - 450;
});
await page.evaluate((y) => window.scrollTo(0, y), cap3Y);
await page.waitForTimeout(3000); // long enough for swim + reveal anim

// Now check alignment at this baseline. CLAVE: medir el HUB (.whatsapp-hub__trigger)
// rendered position, no el pivot bbox. El hub tiene translate(-50%, -50%) interno
// así que su centro está en el transform-origin del pivot, NO en el bbox center.
const baseline = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-03"]');
  const hub = document.querySelector('.companion__pivot .whatsapp-hub__trigger');
  const cr = c.getBoundingClientRect();
  const hr = hub.getBoundingClientRect();
  return {
    scrollY: window.scrollY,
    cap3CenterY: cr.top + cr.height / 2,
    hubCenterY: hr.top + hr.height / 2,
    diff: (hr.top + hr.height / 2) - (cr.top + cr.height / 2),
  };
});
console.log('Baseline (settled):', JSON.stringify(baseline, null, 2));

// Now do incremental scrolls and capture alignment at each
console.log('\nScroll incrementally and check alignment:');
const samples = [];
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.scrollBy(0, 50));
  await page.waitForTimeout(30); // tiny delay between scrolls, simulates user input
  const m = await page.evaluate(() => {
    const c = document.querySelector('[appCompanionDock="cap-03"]');
    const hub = document.querySelector('.companion__pivot .whatsapp-hub__trigger');
    if (!c || !hub) return null;
    const cr = c.getBoundingClientRect();
    const hr = hub.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      diff: (hr.top + hr.height / 2) - (cr.top + cr.height / 2),
    };
  });
  samples.push(m);
  console.log(`  scrollY=${Math.round(m.scrollY)} diff=${m.diff.toFixed(2)}px`);
}

const maxDiff = Math.max(...samples.map(s => Math.abs(s.diff)));
console.log(`\nMax misalignment during scroll: ${maxDiff.toFixed(2)}px`);
console.log(maxDiff < 2 ? '✓ ALINEADO' : '✗ DESALINEADO');

// Cropped screenshot at last position to compare visually
const cap3Box = await page.locator('[appCompanionDock="cap-03"]').boundingBox();
if (cap3Box) {
  await page.screenshot({
    path: resolve(outDir, 'final-position.png'),
    clip: { x: Math.max(0, cap3Box.x - 30), y: Math.max(0, cap3Box.y - 30), width: 500, height: 100 },
  });
}

await browser.close();
console.log('\nScreenshot saved.');
