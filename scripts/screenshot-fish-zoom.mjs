// Zoom sobre el pez del cursor — verifica que la refracción no le quitó
// detalle al pez (escamas, ojo, aletas). Para esto, paramos el cursor
// quieto cerca del centro del lago y capturamos un crop chico que
// el pez del cursor va a poblar después de algunos segundos.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await mkdir('scripts/_screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});
await ctx.route('**/*', (route) => {
  const headers = { ...route.request().headers(), 'cache-control': 'no-cache' };
  route.continue({ headers });
});
const page = await ctx.newPage();
page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[WolfLakeFlow]') || text.includes('FishThree shader')) {
    console.log('[browser]', text);
  }
});

await page.goto('http://localhost:4200/?_=' + Date.now(), {
  waitUntil: 'networkidle',
  timeout: 30000,
});

await page.waitForTimeout(6000);

// Mover cursor a un punto del lago en el centro-medio, donde el usuario
// dice que ANTES se veía el pez pegado encima del agua. El cursor fish
// nadará hacia ese punto.
await page.mouse.move(720, 620);
await page.waitForTimeout(3500);

// Crop muy chico centrado en ese punto — debería mostrar el cursor fish
// con todos sus detalles, ahora ondulándose con el agua.
const zoomPath = join('scripts/_screenshots', `fish-zoom-${stamp}.png`);
await page.screenshot({
  path: zoomPath,
  fullPage: false,
  clip: { x: 540, y: 480, width: 500, height: 350 },
});
console.log('shot', zoomPath);

// 3 frames más para ver el wobble en secuencia
for (let i = 1; i <= 3; i++) {
  await page.waitForTimeout(700);
  const p = join('scripts/_screenshots', `fish-zoom-${stamp}-t${i}.png`);
  await page.screenshot({
    path: p,
    fullPage: false,
    clip: { x: 540, y: 480, width: 500, height: 350 },
  });
  console.log('shot', p);
}

await browser.close();
