// Verifica:
//  A) Scroll DOWN gradual hero→cap-01→cap-02 → swim visible (icono on-screen)
//  B) Scroll UP rápido cap-X → hero → NO swim, teleport (icono off-screen)
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'no-phantom');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(3000);

// ============================================================
// Escenario A: scroll DOWN GRADUAL hasta cap-01
// El user real scrollea progresivo, ícono va siguiendo, swim
// se dispara cuando el dock siguiente entra al viewport.
// ============================================================
console.log('\n=== Escenario A: scroll DOWN gradual ===');

// Instrumentar: pollear .is-swimming cada 30ms
await page.evaluate(() => {
  window.__swimLog = [];
  const start = performance.now();
  let last = false;
  window.__poller = setInterval(() => {
    const piv = document.querySelector('.companion__pivot');
    const sw = piv?.classList.contains('is-swimming') || false;
    if (sw !== last) {
      window.__swimLog.push({ t: Math.round(performance.now() - start), sw });
      last = sw;
    }
  }, 30);
});

// Scroll gradual hacia abajo en pasos de 250px cada 200ms (~rápido pero
// no instantáneo).
for (let i = 0; i < 14; i++) {
  await page.evaluate((dy) => window.scrollBy(0, dy), 250);
  await page.waitForTimeout(200);
}
await page.waitForTimeout(2000); // dejar que termine cualquier swim

const swimLogA = await page.evaluate(() => window.__swimLog);
console.log('Swim transitions during scroll-down:', swimLogA);
const swimsDownA = swimLogA.filter(e => e.sw).length;
console.log('Swims activated:', swimsDownA);

// Capture screenshot during swim if possible — re-trigger by scrolling back
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(2000);

// Reset log, scroll gradually again, take screenshot DURING the swim
await page.evaluate(() => {
  window.__swimLog = [];
  window.__capturePoint = null;
  const start = performance.now();
  let last = false;
  clearInterval(window.__poller);
  window.__poller = setInterval(() => {
    const piv = document.querySelector('.companion__pivot');
    const sw = piv?.classList.contains('is-swimming') || false;
    if (sw && !last) window.__capturePoint = Math.round(performance.now() - start);
    if (sw !== last) {
      window.__swimLog.push({ t: Math.round(performance.now() - start), sw });
      last = sw;
    }
  }, 30);
});

// Scroll gradual de nuevo
for (let i = 0; i < 14; i++) {
  await page.evaluate((dy) => window.scrollBy(0, dy), 250);
  await page.waitForTimeout(200);
  const isSwim = await page.evaluate(() =>
    document.querySelector('.companion__pivot')?.classList.contains('is-swimming') || false
  );
  if (isSwim) {
    // Capturar 4 frames seguidos durante este swim
    for (let f = 0; f < 4; f++) {
      await page.screenshot({
        path: resolve(outDir, `A-down-swim-${i}-${f}.jpg`),
        type: 'jpeg', quality: 85,
      });
      await page.waitForTimeout(180);
    }
    break;
  }
}

// ============================================================
// Escenario B: scroll UP rápido al hero
// ============================================================
console.log('\n=== Escenario B: scroll UP rápido (icono off-screen) ===');
// Asegurar que estamos abajo
await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  if (c) {
    const y = c.getBoundingClientRect().top + window.scrollY - 400;
    window.scrollTo(0, y);
  }
});
await page.waitForTimeout(2500); // dejar settle

const before = await page.evaluate(() => {
  const piv = document.querySelector('.companion__pivot');
  return {
    transform: piv?.style.transform,
    swimming: piv?.classList.contains('is-swimming'),
  };
});
console.log('Antes del jump-up:', before);

await page.evaluate(() => {
  window.__upLog = [];
  const start = performance.now();
  let last = false;
  clearInterval(window.__poller);
  window.__poller = setInterval(() => {
    const piv = document.querySelector('.companion__pivot');
    const sw = piv?.classList.contains('is-swimming') || false;
    if (sw !== last) {
      window.__upLog.push({ t: Math.round(performance.now() - start), sw });
      last = sw;
    }
  }, 16);
});

// Jump al top
await page.evaluate(() => window.scrollTo(0, 0));

// Monitor durante 2.5s
await page.waitForTimeout(2500);
const upLog = await page.evaluate(() => window.__upLog);
console.log('Swim transitions during scroll-up jump:', upLog);
const phantomSwim = upLog.some(e => e.sw);

// Capture final state
await page.screenshot({
  path: resolve(outDir, 'B-up-final.jpg'),
  type: 'jpeg', quality: 85,
});

const after = await page.evaluate(() => {
  const piv = document.querySelector('.companion__pivot');
  return {
    transform: piv?.style.transform,
    swimming: piv?.classList.contains('is-swimming'),
  };
});
console.log('Final state:', after);

await browser.close();
console.log('\n========================================');
console.log('A (down): swims =', swimsDownA, swimsDownA > 0 ? '✓' : '✗');
console.log('B (up):   phantom swim =', phantomSwim, phantomSwim ? '✗ BUG' : '✓ OK');
