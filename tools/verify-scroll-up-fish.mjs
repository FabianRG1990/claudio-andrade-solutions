// Verifica que al scrollear UP (cap-02 → hero) aparezca el pez entrando
// del borde inferior — no del medio del viewport.
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'scroll-up-fish');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg');
await page.waitForTimeout(3000);

// Posicionar en cap-02 (icon docked ahí)
const cap2Y = await page.evaluate(() => {
  const c = document.querySelector('[appCompanionDock="cap-02"]');
  return c.getBoundingClientRect().top + window.scrollY - 400;
});
await page.evaluate((y) => window.scrollTo(0, y), cap2Y);
// Esperar hasta que el swim previo (down) termine COMPLETAMENTE.
let settled = false;
const settleStart = Date.now();
while (Date.now() - settleStart < 6000) {
  const isSwim = await page.evaluate(() =>
    document.querySelector('.companion__pivot')?.classList.contains('is-swimming') || false
  );
  if (!isSwim) {
    await page.waitForTimeout(500); // confirmar settled
    const stillIdle = await page.evaluate(() =>
      !document.querySelector('.companion__pivot')?.classList.contains('is-swimming')
    );
    if (stillIdle) { settled = true; break; }
  }
  await page.waitForTimeout(100);
}
console.log('Previous swim settled:', settled);

const beforeState = await page.evaluate(() => {
  const piv = document.querySelector('.companion__pivot');
  return {
    transform: piv?.style.transform,
    swimming: piv?.classList.contains('is-swimming'),
    scrollY: window.scrollY,
  };
});
console.log('Antes del jump-up:', beforeState);

// Jump al top
await page.evaluate(() => window.scrollTo(0, 0));

// Esperar a que el swim arranque, luego capturar 10 frames seguidos
const startWait = Date.now();
let started = false;
while (Date.now() - startWait < 2000) {
  const swimming = await page.evaluate(() =>
    document.querySelector('.companion__pivot')?.classList.contains('is-swimming') || false
  );
  if (swimming) {
    started = true;
    console.log('Swim started at', Date.now() - startWait, 'ms post-scroll');
    break;
  }
  await page.waitForTimeout(30);
}

if (started) {
  // Capturar 10 frames con ~150ms entre cada uno, sin chequear .is-swimming
  // (puede transicionar a idle mid-screenshot). Cubre los 1500ms del swim.
  for (let i = 0; i < 10; i++) {
    await page.screenshot({
      path: resolve(outDir, `up-${String(i).padStart(2, '0')}.jpg`),
      type: 'jpeg', quality: 85,
    });
    await page.waitForTimeout(150);
  }
} else {
  console.log('NO swim disparado en scroll-up — bug.');
}

await browser.close();
