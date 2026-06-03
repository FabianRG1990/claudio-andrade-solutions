// Captura el lago completo (top zona brillante + bottom zona clara)
// para verificar visualmente que el Gaussian blur post-processing
// afecta solo la zona alta donde reflejan las luces de la ciudad.
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
page.on('console', (msg) => {
  const text = msg.text();
  if (text.includes('[FishThree]') || text.includes('shader compile')) {
    console.log('[browser]', text);
  }
});
await page.goto('http://localhost:4200/?_=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5500);

await page.mouse.move(960, 700); // central para que el cursor fish vaya hacia abajo
await page.waitForTimeout(1500);

for (let i = 0; i < 3; i++) {
  const out = join('scripts/_screenshots', `lake-full-${stamp}-b${i}.png`);
  await page.screenshot({ path: out, fullPage: false, clip: { x: 200, y: 400, width: 1500, height: 600 } });
  console.log('shot', out);
  if (i < 2) await page.waitForTimeout(800);
}

await browser.close();
