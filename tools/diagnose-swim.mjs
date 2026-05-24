// Diagnóstico paso-a-paso del swim:
//   1. Confirmar que el dock cap-01 existe en el DOM
//   2. Trigger scroll directo (window.scrollTo, NO scrollIntoView)
//   3. Capturar muchos frames cortos durante el swim usando setInterval
//      desde el browser (más rápido que page.screenshot Node-side)
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'diagnose-swim');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1000);

// 1. Diagnose: which docks are in the DOM?
const dockInfo = await page.evaluate(() => {
  const all = document.querySelectorAll('[appCompanionDock]');
  return Array.from(all).map(el => ({
    id: el.getAttribute('appCompanionDock'),
    tag: el.tagName,
    rect: el.getBoundingClientRect(),
    text: (el.textContent || '').trim().slice(0, 40),
  }));
});
console.log('Docks found:', JSON.stringify(dockInfo, null, 2));

// 2. cap-01 NO está en el DOM como attribute (Angular property binding no
//    escribe atributos). Scroll to cap-02 instead — el swim activo va a
//    pasar por cap-01 → cap-02 cuando el user scrollea por allí.
const cap2Y = await page.evaluate(() => {
  const cap2 = document.querySelector('[appCompanionDock="cap-02"]');
  if (!cap2) return null;
  const rect = cap2.getBoundingClientRect();
  return rect.top + window.scrollY - window.innerHeight / 2 + rect.height / 2;
});
console.log('cap-02 absolute Y:', cap2Y);

if (cap2Y == null) {
  console.error('cap-02 NOT FOUND in DOM');
  await browser.close();
  process.exit(1);
}

// 3. Subscribe to companion state from the page so we can log swim transitions
await page.evaluate(() => {
  window.__companionLog = [];
  // Spy on requestAnimationFrame to detect when canvas gets a render
  const canvas = document.querySelector('.companion__fish-canvas');
  if (canvas) {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      const origClear = gl.clear.bind(gl);
      gl.clear = function(...args) {
        window.__companionLog.push({ t: performance.now(), event: 'clear', args });
        return origClear(...args);
      };
    }
  }
});

console.log('\nTriggering smooth scroll to cap-02...');
const tStart = await page.evaluate((y) => {
  const t = performance.now();
  window.scrollTo({ top: y, behavior: 'smooth' });
  return t;
}, cap2Y);

// Capture frames every 150ms for 3s to catch the swim
const frames = [];
for (let i = 0; i < 20; i++) {
  const [shot, scrollY] = await Promise.all([
    page.screenshot({ type: 'jpeg', quality: 60 }),
    page.evaluate(() => window.scrollY),
  ]);
  const elapsed = Date.now() - tStart - performance.now();
  frames.push({ i, elapsed, scrollY, shot });
  await page.waitForTimeout(150);
}

// Save the frames
for (const f of frames) {
  writeFileSync(resolve(outDir, `f${String(f.i).padStart(2, '0')}-y${Math.round(f.scrollY)}.jpg`), f.shot);
}

// Get the canvas event log
const log = await page.evaluate(() => window.__companionLog);
console.log('\nCanvas events during capture:', log.length);

await browser.close();
console.log('\nDone. Frames in:', outDir);
