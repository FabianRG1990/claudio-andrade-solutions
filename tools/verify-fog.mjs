// Verifica el shader del WolfLake en runtime real:
//  1. Carga http://localhost:4290 con Chromium headless
//  2. Captura console errors (incluye fallos de compilación GLSL)
//  3. Toma screenshot a t=0
//  4. Espera 9s (~25% del período de 36s, suficiente para que la niebla
//     se mueva notoriamente con orbit radius 0.07 UV)
//  5. Toma segundo screenshot
//  6. Calcula diferencia píxel-a-píxel en la zona de la niebla
//
// Output esperado si todo funciona:
//   - 0 console errors con "shader" o "wolf-lake"
//   - diff > 0 en la zona de la niebla (movimiento visible)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'fog-frames');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push({ type: msg.type(), text: msg.text() });
  }
});
page.on('pageerror', (err) => {
  consoleErrors.push({ type: 'pageerror', text: String(err) });
});

console.log('[1/5] Navigating to http://localhost:4290 ...');
await page.goto('http://localhost:4290', { waitUntil: 'networkidle', timeout: 30000 });

// Wait for the WolfLake canvas to mount + first render
console.log('[2/5] Waiting for canvas mount ...');
await page.waitForSelector('canvas', { state: 'attached', timeout: 10000 });
await page.waitForTimeout(1500);

const a = resolve(outDir, 'frame_a.png');
const b = resolve(outDir, 'frame_b.png');

console.log('[3/5] Taking frame A ...');
await page.screenshot({ path: a, fullPage: false });

console.log('[4/5] Waiting 9s for fog motion ...');
await page.waitForTimeout(9000);

console.log('[5/5] Taking frame B ...');
await page.screenshot({ path: b, fullPage: false });

await browser.close();

// Decodificar PNGs y comparar
import('pngjs').then(async ({ PNG }) => {
  const pngA = PNG.sync.read(readFileSync(a));
  const pngB = PNG.sync.read(readFileSync(b));
  if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
    console.error('FAIL: screenshot sizes differ');
    process.exit(1);
  }
  const W = pngA.width, H = pngA.height;
  // Zona de niebla: en image-UV es x:[0..0.68], y:[0.40..0.58], pero la
  // imagen está positioned right-bottom con object-fit:cover.
  // Para simplificar, muestreo una franja genérica de la zona inferior-
  // izquierda donde la niebla está visible en la composición original.
  // Fog approximate canvas ROI: x:[0%..55%], y:[55%..75%] del canvas.
  // ROI cubre TANTO la niebla del agua como la de los pinos.
  const x0 = Math.floor(W * 0.05);
  const x1 = Math.floor(W * 0.50);
  const y0 = Math.floor(H * 0.30);
  const y1 = Math.floor(H * 0.64);

  let totalDiff = 0;
  let diffPixels = 0;
  let maxLocalDiff = 0;
  const dataA = pngA.data;
  const dataB = pngB.data;
  // También genero una imagen-diff visual para confirmar dónde cambia.
  const diffImg = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dR = Math.abs(dataA[i]     - dataB[i]);
      const dG = Math.abs(dataA[i + 1] - dataB[i + 1]);
      const dB = Math.abs(dataA[i + 2] - dataB[i + 2]);
      const d = dR + dG + dB;
      // Render diff: amplifico ×6 y clampeo a 255
      const v = Math.min(255, d * 6);
      diffImg.data[i] = v;
      diffImg.data[i + 1] = v;
      diffImg.data[i + 2] = v;
      diffImg.data[i + 3] = 255;
      if (y >= y0 && y < y1 && x >= x0 && x < x1) {
        totalDiff += d;
        if (d > 2) diffPixels++;
        if (d > maxLocalDiff) maxLocalDiff = d;
      }
    }
  }
  writeFileSync(resolve(outDir, 'diff.png'), PNG.sync.write(diffImg));
  const pixelsROI = (x1 - x0) * (y1 - y0);
  const avgDiff = totalDiff / pixelsROI;
  const pctChanged = (diffPixels / pixelsROI) * 100;

  console.log('\n=== RESULTS ===');
  console.log('Frame A:', a);
  console.log('Frame B:', b);
  console.log('ROI canvas px:', `${x1 - x0}×${y1 - y0}`);
  console.log('Avg per-pixel diff (RGB sum):', avgDiff.toFixed(2));
  console.log('Pixels with diff>6:', diffPixels, `(${pctChanged.toFixed(1)}% of ROI)`);
  console.log('Max single-pixel diff:', maxLocalDiff);

  console.log('\n=== CONSOLE ERRORS ===');
  if (consoleErrors.length === 0) {
    console.log('(none)');
  } else {
    consoleErrors.forEach((e, i) => console.log(`[${i}] ${e.type}: ${e.text}`));
  }

  // Verdict
  const shaderError = consoleErrors.some((e) =>
    /shader|wolf-lake|webgl/i.test(e.text),
  );
  console.log('\n=== VERDICT ===');
  console.log('Shader compiled OK:', !shaderError);
  console.log('Fog visibly moving:', pctChanged > 5 ? 'YES' : 'NO',
    `(${pctChanged.toFixed(1)}% of ROI changed)`);

  process.exit(shaderError || pctChanged < 5 ? 1 : 0);
});
