// Mueve cursor a la zona BRILLANTE del agua (reflejo de la ciudad)
// para forzar al cursor fish a estar ahi, y capturar como se ve.
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

// Bright reflection zone (city reflected on water): roughly screen
// coords (700-1200, 550-650) on a 1920x1080 viewport.
await page.mouse.move(950, 600);
await page.waitForTimeout(2000); // let cursorFish swim there

for (let i = 0; i < 4; i++) {
  const out = join('scripts/_screenshots', `bright-${stamp}-b${i}.png`);
  await page.screenshot({ path: out, fullPage: false, clip: { x: 600, y: 480, width: 800, height: 280 } });
  console.log('shot', out);
  if (i < 3) await page.waitForTimeout(400);
}

await browser.close();
