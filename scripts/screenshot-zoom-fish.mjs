// Mueve cursor a una zona del lago para atraer el cursorFish, y captura
// zoom extremo. Sirve para ver con detalle cada linea neon procedural.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await mkdir('scripts/_screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  bypassCSP: true,
});
// Disable cache so dev server cambios se reflejan inmediatamente.
await ctx.route('**/*', (route) => {
  const headers = { ...route.request().headers(), 'cache-control': 'no-cache' };
  route.continue({ headers });
});
const page = await ctx.newPage();
await page.goto('http://localhost:4200/?_=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(4500);

// Mueve cursor a una zona donde el cursorFish llegue grande y centrado.
await page.mouse.move(700, 850);
await page.waitForTimeout(1500);

for (let i = 0; i < 5; i++) {
  const out = join('scripts/_screenshots', `zoom-${stamp}-b${i}.png`);
  await page.screenshot({ path: out, fullPage: false, clip: { x: 500, y: 700, width: 500, height: 300 } });
  console.log('shot', out);
  if (i < 4) await page.waitForTimeout(300);
}

await browser.close();
