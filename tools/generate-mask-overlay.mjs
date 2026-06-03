// Genera un PNG visualización: hero-mk6.png con la lake-mask-mk3.png
// pintada encima de las zonas no-nadables (rojo translúcido). El usuario
// usa este overlay para marcar dónde quiere mover/ajustar los límites
// del lago. Después se actualiza el LAKE_POLYGON en generate-masks.mjs.
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const heroDir = resolve(__dirname, '..', 'apps/claudio-andrade-solutions/public/hero-wolf');

console.log('[1/4] Loading hero-mk6.png...');
const heroPng = PNG.sync.read(readFileSync(resolve(heroDir, 'hero-mk6.png')));
console.log(`  ${heroPng.width}×${heroPng.height}`);

console.log('[2/4] Loading lake-mask-mk3.png...');
const maskPng = PNG.sync.read(readFileSync(resolve(heroDir, 'lake-mask-mk3.png')));
console.log(`  ${maskPng.width}×${maskPng.height}`);

if (heroPng.width !== maskPng.width || heroPng.height !== maskPng.height) {
  throw new Error('Hero and mask have different dimensions');
}

const W = heroPng.width;
const H = heroPng.height;

console.log('[3/4] Compositing red overlay on no-swim zones...');
const out = new PNG({ width: W, height: H });
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    // Mask: white (255) = pez puede nadar, black (0) = no puede.
    // Pintamos rojo translúcido donde mask es < 128 (no-swim).
    const maskV = maskPng.data[i]; // grayscale, R channel suffices
    const heroR = heroPng.data[i];
    const heroG = heroPng.data[i + 1];
    const heroB = heroPng.data[i + 2];

    if (maskV < 128) {
      // Zona NO-nadable → mezclar rojo translúcido (alpha 0.45)
      const a = 0.45;
      out.data[i]     = Math.round(heroR * (1 - a) + 255 * a);
      out.data[i + 1] = Math.round(heroG * (1 - a) + 0   * a);
      out.data[i + 2] = Math.round(heroB * (1 - a) + 0   * a);
    } else {
      // Zona nadable → hero original sin tocar
      out.data[i]     = heroR;
      out.data[i + 1] = heroG;
      out.data[i + 2] = heroB;
    }
    out.data[i + 3] = 255;
  }
}

console.log('[4/4] Writing tools/mask-overlay.png...');
const outPath = resolve(__dirname, 'mask-overlay.png');
writeFileSync(outPath, PNG.sync.write(out));
console.log(`  ->`, outPath);
console.log('\nListo. Abrí el archivo y marcá los cambios que querés en los límites.');
