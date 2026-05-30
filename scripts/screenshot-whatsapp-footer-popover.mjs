// Verifica que el popover del WhatsappHub en el FOOTER (variante lg) sigue
// funcionando bien en desktop (sin cambios visuales respecto al diseño
// original — la lógica viewport-aware no debería activarse porque el footer
// trigger está en una zona con suficiente espacio).

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const outDir = 'scripts/_screenshots';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// Scroll al footer.
await page.evaluate(() => {
  const footer = document.querySelector('footer, app-footer, .footer');
  if (footer) footer.scrollIntoView({ block: 'end' });
});
await page.waitForTimeout(1500);

// Click trigger del footer (variante lg).
const trigger = await page.$('footer .whatsapp-hub__trigger, app-footer .whatsapp-hub__trigger, .footer .whatsapp-hub__trigger');
if (!trigger) {
  console.log('MISS: no footer trigger');
  await browser.close();
  process.exit(1);
}
await trigger.click();
await page.waitForTimeout(400);

const rect = await page.evaluate(() => {
  const triggers = document.querySelectorAll('.whatsapp-hub__menu');
  // Buscar el que está visible (el del footer, no el del companion)
  for (const m of triggers) {
    const r = m.getBoundingClientRect();
    if (r.width > 0 && getComputedStyle(m).visibility === 'visible') {
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }
  }
  return null;
});

console.log('footer popover rect:', rect);

await page.screenshot({ path: `${outDir}/footer-popover-${stamp}.png`, fullPage: false });

// Verificar dentro de viewport (lado horizontal por lo menos)
const VW = 1440, VH = 900, SAFE = 8;
if (rect) {
  const okH = rect.left >= SAFE && rect.right <= VW - SAFE;
  const okV = rect.top >= 0 && rect.bottom <= VH;
  console.log(okH && okV ? 'OK' : 'FAIL');
}

await browser.close();
