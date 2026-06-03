// Screenshot + captura logs de consola del browser. Usado para extraer
// el bounding box del mesh GLB en tiempo real.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
await mkdir('scripts/_screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));

await page.goto('http://localhost:4200/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

const bboxLog = logs.find((l) => l.includes('mesh bbox'));
console.log('BBOX:', bboxLog || 'NOT FOUND');

for (let i = 0; i < 4; i++) {
  const out = join('scripts/_screenshots', `bbox-${stamp}-b${i}.png`);
  await page.screenshot({ path: out, fullPage: false, clip: { x: 1150, y: 750, width: 600, height: 260 } });
  console.log('shot', out);
  if (i < 3) await page.waitForTimeout(400);
}

console.log('--- CONSOLE LOGS (first 30) ---');
for (const l of logs.slice(0, 30)) console.log(l);

await browser.close();
