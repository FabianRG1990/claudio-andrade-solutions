// Screenshot del área bottom-left del lago — donde el user marcó el pez
// que tiene la apariencia target. Capturamos un crop chico ahí para ver
// si los peces ambientales que pasan por esa zona quedaron como el
// marcado.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await mkdir('scripts/_screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
await ctx.route('**/*', (route) => {
  const headers = { ...route.request().headers(), 'cache-control': 'no-cache' };
  route.continue({ headers });
});
const page = await ctx.newPage();
page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[WolfLakeFlow]')) console.log('[browser]', text);
});

await page.goto('http://localhost:4200/?_=' + Date.now(), {
  waitUntil: 'networkidle',
  timeout: 30000,
});
await page.waitForTimeout(6000);

// Cursor al área marcada por el user — bottom-left del lago.
// En el screenshot del user, el pez marcado estaba ~(200, 820) en su
// viewport 1920px. Yo lo posiciono ahí para que el cursor fish también
// nade hasta ese punto.
await page.mouse.move(220, 800);
await page.waitForTimeout(3000);

// (1) Hero completo — para comparar holístico
const heroPath = join('scripts/_screenshots', `fish-bl-${stamp}-hero.png`);
await page.screenshot({
  path: heroPath,
  fullPage: false,
  clip: { x: 0, y: 0, width: 1920, height: 1080 },
});
console.log('shot', heroPath);

// (2) Crop bottom-left zoom — donde está el cursor + ambientales
const blPath = join('scripts/_screenshots', `fish-bl-${stamp}-zoom.png`);
await page.screenshot({
  path: blPath,
  fullPage: false,
  clip: { x: 50, y: 700, width: 700, height: 380 },
});
console.log('shot', blPath);

// (3) Crop mid-lake para ver peces ambientales en el centro
const midPath = join('scripts/_screenshots', `fish-bl-${stamp}-mid.png`);
await page.screenshot({
  path: midPath,
  fullPage: false,
  clip: { x: 700, y: 500, width: 1000, height: 400 },
});
console.log('shot', midPath);

await browser.close();
