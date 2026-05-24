// Verificación específica del hero: ¿el ícono queda dentro del boundary
// derecho del wave-card / aside?
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'companion');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:4202/', { waitUntil: 'load' });
await page.waitForSelector('.hero__bg', { timeout: 10000 });
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1500);

// Pintamos una línea roja en el borde derecho del .hero__aside (como hizo
// el user en su screenshot) para validar que el ícono queda DENTRO.
await page.evaluate(() => {
  const aside = document.querySelector('.hero__aside') || document.querySelector('.hero__scroll-hint');
  if (!aside) return;
  const r = aside.getBoundingClientRect();
  const line = document.createElement('div');
  line.style.cssText = `
    position: fixed; top: 0; left: ${r.right - 1}px;
    width: 2px; height: 100vh; background: red;
    z-index: 9999; pointer-events: none;
  `;
  document.body.appendChild(line);
});

await page.screenshot({
  path: resolve(outDir, 'hero-boundary-check.png'),
  clip: { x: 800, y: 600, width: 800, height: 200 },
});

await browser.close();
console.log('Saved hero-boundary-check.png');
