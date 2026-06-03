// Compone la máscara del lago encima de MK3 con tinte cyan al 35% para
// inspeccionar visualmente la alineación. Si el cyan invade el lobo o
// el cielo, la máscara está mal — hay que retocar el polígono.
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const heroPath = resolve(__dirname, '..', 'apps/claudio-andrade-solutions/public/hero-wolf/hero-mk3.png');
const maskPath = resolve(__dirname, '..', 'apps/claudio-andrade-solutions/public/hero-wolf/lake-mask-mk3.png');
const outPath = resolve(__dirname, 'mask-overlay.png');

const hero = PNG.sync.read(readFileSync(heroPath));
const mask = PNG.sync.read(readFileSync(maskPath));

if (hero.width !== mask.width || hero.height !== mask.height) {
  console.error(`Dimension mismatch — hero: ${hero.width}×${hero.height}, mask: ${mask.width}×${mask.height}`);
  process.exit(1);
}

const W = hero.width, H = hero.height;
const out = new PNG({ width: W, height: H });

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const m = mask.data[i] / 255; // 0..1, white = lake
    const r = hero.data[i];
    const g = hero.data[i + 1];
    const b = hero.data[i + 2];

    // Tinte cyan en zona de lago (mask>0.5), tinte rojo en no-lago.
    const tintAlpha = 0.35;
    const tintR = m > 0.5 ? 80 : 255;
    const tintG = m > 0.5 ? 220 : 80;
    const tintB = m > 0.5 ? 240 : 80;

    out.data[i]     = Math.round(r * (1 - tintAlpha) + tintR * tintAlpha);
    out.data[i + 1] = Math.round(g * (1 - tintAlpha) + tintG * tintAlpha);
    out.data[i + 2] = Math.round(b * (1 - tintAlpha) + tintB * tintAlpha);
    out.data[i + 3] = 255;
  }
}

writeFileSync(outPath, PNG.sync.write(out));
console.log('Overlay:', outPath);
