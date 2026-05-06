// Snapshot del WolfLandscape para verificación visual.
// Toma 3 capturas: estática, después de mover el mouse al lago, y otra
// 1.5s después (para capturar peces reaccionando + ondas).

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = 'http://localhost:4205/';
const OUT_DIR = __dirname;

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // Capturas a tamaño completo para distinguir los peces y las ondas.
  await page.screenshot({
    path: resolve(OUT_DIR, 'snap-1-initial.png'),
    fullPage: false,
  });

  // Hookeamos un log de console para ver qué ve el componente
  const logs = [];
  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Inyectamos un debug que loguee el estado del fish state machine
  await page.evaluate(() => {
    // @ts-ignore
    window.__debug = { lastLog: 0 };
  });

  // Mover lentamente al lago izquierdo
  await page.mouse.move(700, 600, { steps: 50 });
  await page.waitForTimeout(300);
  // Mover en círculo para ver peces seguir
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const cx = 700 + Math.cos(a) * 150;
    const cy = 600 + Math.sin(a) * 80;
    await page.mouse.move(cx, cy, { steps: 5 });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(200);

  await page.screenshot({
    path: resolve(OUT_DIR, 'snap-2-circle-motion.png'),
    fullPage: false,
  });

  // Esperar y capturar cómo se desvanecen las ondas
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: resolve(OUT_DIR, 'snap-3-fade.png'),
    fullPage: false,
  });

  // Capturar errores de consola
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push('PAGE ERR: ' + err.message));
  await page.waitForTimeout(200);

  await browser.close();
  if (errors.length) {
    console.log('CONSOLE ERRORS:');
    for (const e of errors) console.log('  - ' + e);
  } else {
    console.log('No console errors captured.');
  }
  console.log('Snapshots written to:', OUT_DIR);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
