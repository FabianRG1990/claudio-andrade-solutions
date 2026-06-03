// Genera lake-mask-mk3.png erosionando water-mask-mk6.png 1rem (16px)
// hacia adentro.
//
// Approach anterior (polígono manual): el usuario tenía que estimar
// vértices visualmente y yo los implementaba en código → loop frágil
// que terminó con peces volando sobre la ciudad porque mis estimaciones
// no matcheaban exactamente la orilla real.
//
// Approach nuevo (water-mask + erode): water-mask-mk6.png es ground
// truth — define con anti-aliasing dónde está el agua (la usa el shader
// de ondas wolf-lake-flow.ts). Erosionarla 16px shrink el área un rem
// hacia adentro → margen suficiente para que el pez NO toque la orilla,
// y el límite sigue automáticamente la geometría real del lago.
//
// Algoritmo de erosión: separable min filter (2 passes O(W*H*R)).
// Por cada pixel, output = MIN de todos los pixels dentro de radius R.
// Esto encoge el área blanca (agua) por R pixels en todas direcciones.
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const heroDir = resolve(__dirname, '..', 'apps/claudio-andrade-solutions/public/hero-wolf');

const ERODE_PX = 16; // 1rem — margen del pez a la orilla

console.log(`[1/4] Loading water-mask-mk6.png (ground truth)...`);
const src = PNG.sync.read(readFileSync(resolve(heroDir, 'water-mask-mk6.png')));
const W = src.width;
const H = src.height;
console.log(`  ${W}×${H}`);

// Extraer canal R como Uint8Array (la mask es grayscale, RGB iguales)
console.log('[2/4] Extracting grayscale channel...');
const gray = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  gray[i] = src.data[i * 4];
}

console.log(`[3/5] Eroding ${ERODE_PX}px (separable min filter)...`);
console.time('  erode');
const eroded = erodeSeparable(gray, W, H, ERODE_PX);
console.timeEnd('  erode');

// Binarizar — hard edge, no feathered. CRÍTICO para fish boundary
// detection: con feather, la zona donde sampleMask retorna 0.4-0.85
// genera "limbo" entre cursorOnWater y wallAvoidance → oscilación
// 60Hz cuando el pez se acerca a la orilla = "zigzag de serpiente"
// reportada por el usuario. Threshold a 128 (mid-gray) para que el
// borde quede en el pixel exacto donde el min filter dejó la mitad.
console.log('[4/5] Binarizing (threshold 128)...');
for (let i = 0; i < W * H; i++) {
  eroded[i] = eroded[i] >= 128 ? 255 : 0;
}

// Reconstruir PNG RGBA
console.log('[5/5] Writing lake-mask-mk3.png...');
const out = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) {
  const v = eroded[i];
  out.data[i * 4]     = v;
  out.data[i * 4 + 1] = v;
  out.data[i * 4 + 2] = v;
  out.data[i * 4 + 3] = 255;
}
const outPath = resolve(heroDir, 'lake-mask-mk3.png');
writeFileSync(outPath, PNG.sync.write(out));
console.log(`  ->`, outPath);

// Bounding box del agua erosionada para sanity check
let minX = W, minY = H, maxX = 0, maxY = 0;
let waterPx = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (eroded[y * W + x] > 128) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      waterPx++;
    }
  }
}
console.log(`\nLake (eroded) bounding box:`);
console.log(`  x: ${minX}..${maxX}  (${maxX - minX}px wide)`);
console.log(`  y: ${minY}..${maxY}  (${maxY - minY}px tall)`);
console.log(`  normalized: x:${(minX/W).toFixed(3)}..${(maxX/W).toFixed(3)}  y:${(minY/H).toFixed(3)}..${(maxY/H).toFixed(3)}`);
console.log(`  area: ${waterPx} px (${((waterPx/(W*H))*100).toFixed(1)}% del canvas)`);
console.log('\nDone. Inspect lake-mask-mk3.png o corré generate-mask-overlay.mjs.');

// ──────────────────────────────────────────────────────────────────────
// Erosion via separable min filter — O(W*H*R) por axis, total O(W*H*R*2).
// Para W=1672 H=941 R=16: ~100M ops. ~1-2s en Node.
function erodeSeparable(src, w, h, r) {
  const tmp = new Uint8Array(w * h);
  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minV = 255;
      for (let dx = -r; dx <= r; dx++) {
        const sx = x + dx;
        if (sx < 0 || sx >= w) { minV = 0; break; }
        const v = src[y * w + sx];
        if (v < minV) minV = v;
      }
      tmp[y * w + x] = minV;
    }
  }
  // Vertical pass
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minV = 255;
      for (let dy = -r; dy <= r; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= h) { minV = 0; break; }
        const v = tmp[sy * w + x];
        if (v < minV) minV = v;
      }
      out[y * w + x] = minV;
    }
  }
  return out;
}
