// Screenshot para verificar el efecto de refracción de los peces aplicado
// por el flow shader. Captura 3 escenarios:
//   1. Hero completo, cursor en el centro del lago → verifica que los peces
//      ahora se ven ondulándose con el agua, no pegados encima.
//   2. Crop a la zona media del lago (donde antes se veían encima del agua).
//   3. Frame 2 segundos después para ver el wobble del flow.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await mkdir('scripts/_screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2, // matchear DPR alto para no perder detalle del pez
});
await ctx.route('**/*', (route) => {
  const headers = { ...route.request().headers(), 'cache-control': 'no-cache' };
  route.continue({ headers });
});
const page = await ctx.newPage();
page.on('console', (msg) => {
  const text = msg.text();
  if (
    text.includes('[FishThree]') ||
    text.includes('[WolfLakeFlow]') ||
    text.includes('[WolfLakeCanvas]') ||
    text.includes('shader compile')
  ) {
    console.log('[browser]', text);
  }
});

await page.goto('http://localhost:4200/?_=' + Date.now(), {
  waitUntil: 'networkidle',
  timeout: 30000,
});

// Esperar a que el shader cargue, peces aparezcan, y el flow corra ciclos
await page.waitForTimeout(7000);

// Cursor al centro-bajo del lago. El pez del cursor va a navegar a esa
// posición; los ambientales ya están repartidos.
await page.mouse.move(960, 720);
await page.waitForTimeout(2500);

// (1) Hero completo
const heroPath = join('scripts/_screenshots', `fish-refraction-${stamp}-hero.png`);
await page.screenshot({
  path: heroPath,
  fullPage: false,
  clip: { x: 0, y: 0, width: 1920, height: 1000 },
});
console.log('shot', heroPath);

// (2) Zona media del lago — donde el pez antes se veía "pegado encima"
const midPath = join('scripts/_screenshots', `fish-refraction-${stamp}-mid.png`);
await page.screenshot({
  path: midPath,
  fullPage: false,
  clip: { x: 400, y: 500, width: 1100, height: 400 },
});
console.log('shot', midPath);

// (3) Mismo crop 2s después para ver el wobble
await page.waitForTimeout(2000);
const mid2Path = join('scripts/_screenshots', `fish-refraction-${stamp}-mid-2s.png`);
await page.screenshot({
  path: mid2Path,
  fullPage: false,
  clip: { x: 400, y: 500, width: 1100, height: 400 },
});
console.log('shot', mid2Path);

await browser.close();
