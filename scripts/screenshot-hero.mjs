// Captura el hero del dev server para verificar visualmente los peces.
// Modos:
//   default: 1 screenshot del hero (1920x1080) a los waitMs
//   --burst: 4 screenshots seguidos cada 800ms (ver motion)
//   --hover <x> <y>: mueve cursor a (x,y) px y captura — fuerza cursorFish
//                   a una posicion conocida
//
// Uso:
//   node scripts/screenshot-hero.mjs
//   node scripts/screenshot-hero.mjs --burst
//   node scripts/screenshot-hero.mjs --hover 700 600

import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const isBurst = args.includes('--burst');
const hoverIdx = args.indexOf('--hover');
const hover = hoverIdx >= 0 ? { x: Number(args[hoverIdx + 1]), y: Number(args[hoverIdx + 2]) } : null;

const url = 'http://localhost:4200/';
const outDir = 'scripts/_screenshots';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
});
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

console.log(`[shot] navigating to ${url}`);
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

// Espera inicial: deja que el GLB cargue (~7MB) y los peces spawneen + se animen.
await page.waitForTimeout(4500);

if (hover) {
  console.log(`[shot] moving cursor to (${hover.x}, ${hover.y})`);
  await page.mouse.move(hover.x, hover.y);
  await page.waitForTimeout(1200); // deja que el cursorFish nade hasta el target
}

if (isBurst) {
  // Burst de 6 frames cada 200ms — ver wave del cuerpo + heading change.
  // Clip area opcional para zoom en zona especifica del lago.
  const clipIdx = args.indexOf('--clip');
  const clip = clipIdx >= 0
    ? { x: Number(args[clipIdx + 1]), y: Number(args[clipIdx + 2]),
        width: Number(args[clipIdx + 3]), height: Number(args[clipIdx + 4]) }
    : null;
  for (let i = 0; i < 6; i++) {
    const out = join(outDir, `hero-${stamp}-b${i}.png`);
    await page.screenshot({ path: out, fullPage: false, clip: clip ?? undefined });
    console.log(`[shot] burst ${i + 1}/6 → ${out}`);
    if (i < 5) await page.waitForTimeout(200);
  }
} else if (args.includes('--stuck-detect')) {
  // Modo stuck-detect: toma 3 screenshots con 8s entre medio para identificar
  // visualmente que pez no se movio.
  for (let i = 0; i < 3; i++) {
    if (i > 0) await page.waitForTimeout(8000);
    const out = join(outDir, `hero-${stamp}-stuck${i}.png`);
    await page.screenshot({ path: out, fullPage: false });
    console.log(`[shot] stuck-detect ${i + 1}/3 (t=${i * 8}s) → ${out}`);
  }
} else {
  const suffix = hover ? `-hover-${hover.x}x${hover.y}` : '';
  const out = join(outDir, `hero-${stamp}${suffix}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`[shot] → ${out}`);
}

if (errors.length) {
  console.log(`[shot] ${errors.length} console error(s):`);
  for (const e of errors.slice(0, 10)) console.log('  •', e);
} else {
  console.log('[shot] no console errors');
}

await browser.close();
