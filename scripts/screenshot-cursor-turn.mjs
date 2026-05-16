// Force el cursorFish a girar moviendo el cursor de un lado a otro, y
// capturando burst durante el giro. Captura el destello-fresnel-boost
// que aparece cuando la curva del cuerpo esta de perfil a la camara.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await mkdir('scripts/_screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.route('**/*', (route) => {
  const headers = { ...route.request().headers(), 'cache-control': 'no-cache' };
  route.continue({ headers });
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/?_=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(4500);

// Movimiento brusco izq → der → izq para forzar giros agudos.
await page.mouse.move(400, 900);
await page.waitForTimeout(800);

for (let i = 0; i < 8; i++) {
  // Movimiento brusco a un lado opuesto en cada iteracion → fish gira.
  const targetX = (i % 2 === 0) ? 1500 : 400;
  await page.mouse.move(targetX, 900);
  await page.waitForTimeout(200);
  const out = join('scripts/_screenshots', `turn-${stamp}-b${i}.png`);
  await page.screenshot({ path: out, fullPage: false, clip: { x: 350, y: 750, width: 1200, height: 300 } });
  console.log('shot', out);
}

await browser.close();
