// Verifica la animación del pez:
//   - El ícono NO desaparece durante scroll (sigue visible hasta que el pez arranca)
//   - El path del pez es CONSISTENTE (siempre arquea hacia la izquierda)
//   - El pez no aparece en lugares random del centro
//
// Para esto: settle en hero, luego scrollIntoView de cap-01 (esto tarda
// 250ms en disparar el swim), captura 8 frames durante el swim (~1500ms).
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'fish-path');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg', { timeout: 10000 });
await page.waitForTimeout(2500); // canvas + GLB ready
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800); // settle at hero

// Frame 1: hero settled (icono visible en HABLEMOS)
await page.screenshot({ path: resolve(outDir, '00-hero-settled.png'), fullPage: false });
console.log('[00] hero settled');

// Disparar scroll hacia cap-01 y empezar a capturar frames inmediatamente
const swimStartedAt = Date.now();
await page.evaluate(() => {
  const cap1 = document.querySelector('[appCompanionDock="cap-01"]');
  if (cap1) cap1.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// Capturar 10 frames durante los próximos ~3 segundos (cubre el debounce 250ms
// + el swim 1500ms + un poco más para ver el landing)
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(300);
  const elapsed = Date.now() - swimStartedAt;
  await page.screenshot({
    path: resolve(outDir, `swim-${String(i).padStart(2, '0')}-t${elapsed}ms.png`),
    fullPage: false,
  });
  console.log(`[${i}] t=${elapsed}ms`);
}

// Frame final: settled en cap-01
await page.waitForTimeout(1000);
await page.screenshot({ path: resolve(outDir, '99-cap-01-settled.png'), fullPage: false });
console.log('[99] cap-01 settled');

await browser.close();

console.log('\nConsole errors:', errors.length === 0 ? '(none)' : errors);
console.log('Screenshots in:', outDir);
