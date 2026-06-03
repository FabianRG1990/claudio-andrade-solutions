// Verifica que el popover del WhatsappHub no se corte por los bordes del
// viewport en mobile. Recorre los docks (hero, cap-02, cap-03, cap-05,
// timeline-head, timeline-stack), abre el popover en cada uno y mide su
// bounding rect contra el viewport. Falla si algún borde queda fuera del
// margen seguro.

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const base = 'http://localhost:4200';
const outDir = 'scripts/_screenshots';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const viewportWidth = parseInt(process.env.VW || '393', 10);
const viewportHeight = parseInt(process.env.VH || '852', 10);
const ctx = await browser.newContext({
  viewport: { width: viewportWidth, height: viewportHeight },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
});
const page = await ctx.newPage();
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500); // dejar que companion monte + dock se registre

// Lista de targets: scroll al eyebrow del dock, esperar swim, abrir popover.
const targets = [
  { selector: '[appCompanionDock="hero"]', label: 'hero' },
  { selector: '[appCompanionDock="cap-02"]', label: 'cap-02' },
  { selector: '[appCompanionDock="cap-03"]', label: 'cap-03' },
  { selector: '[appCompanionDock="cap-05"]', label: 'cap-05' },
  { selector: '[appCompanionDock="timeline-head"]', label: 'timeline-head' },
  { selector: '[appCompanionDock="timeline-stack"]', label: 'timeline-stack' },
];

const SAFE = 8;
const VW = viewportWidth;
const VH = viewportHeight;
console.log(`Testing at ${VW}x${VH}`);
let failures = 0;

for (const t of targets) {
  // Anchor para "hero" es width/height 0 — scrollIntoViewIfNeeded falla.
  // Usar scroll manual con getBoundingClientRect que sí funciona en
  // elementos invisibles.
  const found = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    window.scrollBy(0, rect.top - window.innerHeight * 0.55);
    return true;
  }, t.selector);
  if (!found) {
    console.log(`MISS  ${t.label} (no anchor)`);
    continue;
  }
  // Esperar fin del swim (DOCK_DEBOUNCE_MS=250 + swim ~1900ms peor caso).
  await page.waitForTimeout(2600);

  // Clickear el trigger (la variante sm del companion).
  const trigger = await page.$('.companion__pivot .whatsapp-hub__trigger');
  if (!trigger) {
    console.log(`MISS  ${t.label} (no companion trigger visible)`);
    continue;
  }
  await trigger.click();
  await page.waitForTimeout(400);

  // Medir el rect del popover.
  const rect = await page.evaluate(() => {
    const menu = document.querySelector('.companion__pivot .whatsapp-hub__menu');
    if (!menu) return null;
    const r = menu.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });
  if (!rect) {
    console.log(`MISS  ${t.label} (no popover element)`);
    continue;
  }

  const overflowsLeft = rect.left < SAFE;
  const overflowsRight = rect.right > VW - SAFE;
  const overflowsTop = rect.top < 0;
  const overflowsBottom = rect.bottom > VH;
  const ok = !overflowsLeft && !overflowsRight && !overflowsTop && !overflowsBottom;
  if (!ok) failures++;
  const status = ok ? 'OK   ' : 'FAIL ';
  console.log(
    `${status} ${t.label.padEnd(16)} L=${rect.left.toFixed(1).padStart(7)} R=${rect.right.toFixed(1).padStart(7)} T=${rect.top.toFixed(1).padStart(7)} B=${rect.bottom.toFixed(1).padStart(7)}  W=${rect.width.toFixed(0)}xH=${rect.height.toFixed(0)}`
    + (overflowsLeft ? '  [LEFT-CUT]' : '')
    + (overflowsRight ? '  [RIGHT-CUT]' : '')
    + (overflowsTop ? '  [TOP-CUT]' : '')
    + (overflowsBottom ? '  [BOTTOM-CUT]' : ''),
  );

  // Screenshot full viewport para inspección visual.
  const shotPath = `${outDir}/popover-${t.label}-${stamp}.png`;
  await page.screenshot({ path: shotPath, fullPage: false });

  // Cerrar el popover (click body) antes de pasar al siguiente.
  await page.evaluate(() => document.body.click());
  await page.waitForTimeout(200);
}

await browser.close();
console.log(failures === 0 ? '\nALL OK' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
