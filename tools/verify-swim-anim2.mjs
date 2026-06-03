// Test instrumentado: detecta cuándo .is-swimming aparece en el pivot y
// captura frames del canvas durante TODO el swim.
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'swim-anim2');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(3000);
// Garantizar que el companion se inicialice en cap-01 (no en hero)
// scrolleando primero a cap-01.
const cap1Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-01"]');
  return c ? c.getBoundingClientRect().top + window.scrollY - 400 : 0;
});
console.log('Step 1: scroll to cap-01 region', cap1Y);
await page.evaluate((y) => window.scrollTo(0, y), cap1Y);
await page.waitForTimeout(3000); // let any swim finish

// Ahora scroll a cap-02 para disparar UN swim controlado
const cap2Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  return c.getBoundingClientRect().top + window.scrollY - 750;
});
console.log('Step 2: scroll to cap-02 region', cap2Y);

// Instrumentar: pollear .is-swimming cada 30ms
await page.evaluate(() => {
  window.__swimEvents = [];
  const start = performance.now();
  const id = setInterval(() => {
    const pivot = document.querySelector('.companion__pivot');
    const swimming = pivot?.classList.contains('is-swimming') || false;
    window.__swimEvents.push({ t: Math.round(performance.now() - start), swim: swimming });
  }, 16);
  window.__pollerId = id;
});

await page.evaluate((y) => window.scrollTo(0, y), cap2Y);

// Esperar a que swim arranque, capturar mientras swim activo
let started = false;
let captured = 0;
const startWait = Date.now();
while (Date.now() - startWait < 4000) {
  const isSwimming = await page.evaluate(() => {
    return document.querySelector('.companion__pivot')?.classList.contains('is-swimming') || false;
  });
  if (isSwimming) {
    if (!started) {
      console.log(`Swim started at ${Date.now() - startWait}ms`);
      started = true;
    }
    await page.screenshot({
      path: resolve(outDir, `swim-${String(captured).padStart(2, '0')}-${Date.now() - startWait}ms.jpg`),
      type: 'jpeg',
      quality: 85,
    });
    captured++;
    await page.waitForTimeout(120);
  } else {
    if (started) {
      console.log(`Swim ended at ${Date.now() - startWait}ms`);
      break;
    }
    await page.waitForTimeout(50);
  }
}

console.log(`Captured ${captured} frames during swim`);
await browser.close();
