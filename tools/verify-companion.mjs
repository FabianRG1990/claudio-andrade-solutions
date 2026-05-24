// Verificación visual del WhatsApp companion:
//   1. Hero — ícono dentro del boundary del .hero__aside (no sticking out)
//   2. Cada eyebrow — ícono con aire desde el pill (no pegado al pill)
//   3. Scroll — ícono oculto mientras hay scroll activo
//
// Saca screenshots a tools/screenshots/companion/*.png para revisión manual.
import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'screenshots', 'companion');
mkdirSync(outDir, { recursive: true });

const URL = 'http://127.0.0.1:4202/';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

console.log(`[INIT] navigating to ${URL}`);
await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
await page.waitForSelector('.hero__bg', { timeout: 10000 });
await page.waitForTimeout(2500); // dejar que cargue el companion + GLB

// ─── 1. HERO ─────────────────────────────────────────────────────────────────
console.log('[HERO] screenshot at top of page');
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1500); // dejar que el scroll-settle expire (250ms) + idle
await page.screenshot({ path: resolve(outDir, '01-hero-full.png'), fullPage: false });

// Crop al bottom-right del hero para ver el lockup "HABLEMOS + ícono" en detalle
const heroAside = await page.locator('.hero__scroll-hint').boundingBox();
if (heroAside) {
  await page.screenshot({
    path: resolve(outDir, '01-hero-whatsapp-cue.png'),
    clip: {
      x: Math.max(0, heroAside.x - 50),
      y: Math.max(0, heroAside.y - 20),
      width: heroAside.width + 100,
      height: heroAside.height + 40,
    },
  });
}

// ─── 2. CAPÍTULOS — uno por uno ──────────────────────────────────────────────
const docks = [
  { name: 'cap-01-productos', selector: '[appCompanionDock="cap-01"], app-eyebrow:has-text("Capítulo 01")' },
  { name: 'cap-02-ofrecemos', selector: '[appCompanionDock="cap-02"]' },
  { name: 'cap-03-modelos', selector: '[appCompanionDock="cap-03"]' },
  { name: 'cap-04-casos', selector: '[appCompanionDock="cap-04"], app-eyebrow:has-text("Capítulo 04")' },
  { name: 'cap-05-empezar', selector: '[appCompanionDock="cap-05"]' },
  { name: 'timeline-head', selector: '[appCompanionDock="timeline-head"]' },
  { name: 'timeline-milestones', selector: '[appCompanionDock="timeline-milestones"]' },
  { name: 'timeline-stack', selector: '[appCompanionDock="timeline-stack"]' },
];

for (const dock of docks) {
  console.log(`[DOCK ${dock.name}] scrolling into view`);
  try {
    const el = page.locator(dock.selector).first();
    await el.waitFor({ state: 'attached', timeout: 5000 });
    await el.scrollIntoViewIfNeeded({ timeout: 5000 });
    await page.waitForTimeout(2500); // settle + swim (~2s) + idle
    const box = await el.boundingBox();
    if (!box) {
      console.warn(`  -> no boundingBox for ${dock.name}, skipping`);
      continue;
    }
    // Crop alrededor del eyebrow para ver el ícono al lado
    await page.screenshot({
      path: resolve(outDir, `02-${dock.name}-settled.png`),
      clip: {
        x: Math.max(0, box.x - 30),
        y: Math.max(0, box.y - 30),
        width: Math.min(1600 - Math.max(0, box.x - 30), box.width + 250),
        height: Math.min(900 - Math.max(0, box.y - 30), box.height + 60),
      },
    });
  } catch (err) {
    console.warn(`  -> error for ${dock.name}:`, err.message);
  }
}

// ─── 3. SCROLL — ícono debe desaparecer mientras hay scroll activo ────────────
console.log('[SCROLL] verifying icon hides during scroll');
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1500);

// Iniciar scroll continuo + capturar mid-scroll
await page.evaluate(() => {
  let y = 0;
  const id = setInterval(() => {
    y += 50;
    window.scrollTo(0, y);
    if (y > 2000) clearInterval(id);
  }, 30);
  window.__scrollIntervalId = id;
});

// Capturar varios momentos durante el scroll para ver si el ícono está oculto
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(100); // 100ms entre frames
  await page.screenshot({
    path: resolve(outDir, `03-scrolling-${i}.png`),
    fullPage: false,
  });
}

// Esperar a que se asiente el scroll
await page.waitForTimeout(2500);
await page.screenshot({ path: resolve(outDir, '04-after-scroll-settle.png'), fullPage: false });

await browser.close();

console.log('\n=== CONSOLE ERRORS ===');
if (consoleErrors.length === 0) console.log('(none)');
else consoleErrors.forEach((e, i) => console.log(`[${i}]`, e));

console.log(`\nScreenshots in: ${outDir}`);
