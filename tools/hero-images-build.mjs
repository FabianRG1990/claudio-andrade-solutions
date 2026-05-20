#!/usr/bin/env node
/**
 * Hero images build script
 * -----------------------------------------------------------------------------
 * 1) Convierte las 3 imágenes del hero (Downloads) a AVIF + WebP + PNG/JPG.
 * 2) Genera las máscaras de agua para cada variante trazando manualmente el
 *    polígono del lago (no detección automática — el contraste navy/forest/
 *    sky es demasiado bajo para thresholding limpio).
 *
 * Output: apps/claudio-andrade-solutions/public/hero-wolf/
 */

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DOWNLOADS = 'C:/Users/Fabian/Downloads';
const OUT_DIR = resolve(
  process.cwd(),
  'apps/claudio-andrade-solutions/public/hero-wolf',
);

// -----------------------------------------------------------------------------
// Variantes
// -----------------------------------------------------------------------------
const VARIANTS = [
  {
    name: 'phone',
    source: join(DOWNLOADS, 'hero-mk6-mobile-9x16-1080x1920.png'),
    w: 1080,
    h: 1920,
    // Polígono del agua en UV [0..1]. Trazado a mano siguiendo el contorno
    // real de la base de la roca con el lobo + skyline + forest. Más puntos
    // densos en x=0.60-1.0 (zona crítica donde la roca con el lobo entra al
    // agua) para evitar marcar zonas de roca como agua (animaría la roca) y
    // dejar sin marcar zonas reales del lago (no se animarían). Esto resuelve
    // dos issues simultáneamente:
    //   - "el agua afecta la roca / esquina puntiaguda lejana al lobo"
    //   - "el agua debajo del lobo no se mueve"
    waterPoly: [
      [0.00, 0.43],   // borde izquierdo
      [0.05, 0.42],   // skyline reflection
      [0.15, 0.43],   // base del skyline
      [0.30, 0.42],   // final del skyline
      [0.42, 0.42],   // forest plano
      [0.52, 0.41],   // forest ligeramente más alto
      [0.60, 0.44],   // forest baja al agua
      [0.62, 0.46],   // transición forest→roca
      [0.64, 0.48],   // esquina puntiaguda donde la roca entra al agua
      [0.66, 0.50],   // base roca lejana al lobo
      [0.70, 0.52],   // roca sube
      [0.74, 0.55],   // silueta lobo izq, base
      [0.80, 0.56],   // base/pecho del lobo
      [0.86, 0.58],   // parte trasera del lobo
      [0.90, 0.62],   // roca desciende
      [0.94, 0.66],   // extremo de la roca
      [0.98, 0.74],   // borde casi en el bottom
      [1.00, 0.78],   // borde derecho
      [1.00, 1.00],
      [0.00, 1.00],
    ],
  },
  {
    name: 'tablet',
    source: join(DOWNLOADS, 'hero-square-1x1-1600-cover.png'),
    w: 1600,
    h: 1600,
    waterPoly: [
      [0.00, 0.40],
      [0.08, 0.39],   // forest left
      [0.15, 0.39],
      [0.22, 0.41],   // bordeando skyline base
      [0.30, 0.42],   // skyline center
      [0.40, 0.40],   // skyline end
      [0.50, 0.43],   // forest right of skyline
      [0.55, 0.43],
      [0.62, 0.42],   // antes de la roca
      [0.68, 0.43],   // base roca
      [0.75, 0.45],   // roca subiendo
      [0.82, 0.45],
      [0.90, 0.45],
      [0.95, 0.45],   // forest right
      [1.00, 0.43],   // borde derecho
      [1.00, 1.00],
      [0.00, 1.00],
    ],
  },
  {
    name: 'cinematic',
    source: join(DOWNLOADS, 'hero-mk6-21x9-2520x1080-cover.jpg'),
    w: 2520,
    h: 1080,
    waterPoly: [
      [0.00, 0.47],
      [0.05, 0.47],   // rocas pequeñas izquierda
      [0.12, 0.47],   // forest izquierdo
      [0.20, 0.47],
      [0.30, 0.47],
      [0.40, 0.45],   // cerca del skyline
      [0.50, 0.43],   // bajo el skyline
      [0.60, 0.43],
      [0.70, 0.45],
      [0.80, 0.47],   // más forest
      [0.85, 0.47],   // entre forest y roca
      [0.88, 0.48],   // roca entrando
      [0.92, 0.55],   // roca bajando
      [0.96, 0.65],   // roca cerca del lobo
      [1.00, 0.78],   // roca al borde derecho
      [1.00, 1.00],
      [0.00, 1.00],
    ],
  },
];

// -----------------------------------------------------------------------------
// Convert the source image to AVIF + WebP + PNG/JPG.
// -----------------------------------------------------------------------------
async function convertImage(v) {
  const baseName = `hero-mk6-${v.name}`;
  const out = (ext) => join(OUT_DIR, `${baseName}.${ext}`);

  // Sharp pipeline base — leer y normalizar a sRGB.
  const src = sharp(v.source).withMetadata();

  // AVIF — q60 da el mejor balance peso/calidad para hero images. effort 6.
  await src
    .clone()
    .avif({ quality: 60, effort: 6, chromaSubsampling: '4:2:0' })
    .toFile(out('avif'));

  // WebP — q82 para hero (calidad alta, peso razonable).
  await src.clone().webp({ quality: 82, effort: 6 }).toFile(out('webp'));

  // Fallback. Para phone/tablet PNG; para cinematic mantenemos JPG (ya era jpg).
  if (v.name === 'cinematic') {
    await src
      .clone()
      .jpeg({ quality: 85, progressive: true, mozjpeg: true })
      .toFile(out('jpg'));
  } else {
    await src
      .clone()
      .png({ compressionLevel: 9, palette: false })
      .toFile(out('png'));
  }

  console.log(`  ${baseName}: avif/webp/${v.name === 'cinematic' ? 'jpg' : 'png'} ✓`);
}

// -----------------------------------------------------------------------------
// Build a mask PNG by rasterizing an SVG with the manual polygon.
//   • `water-mask-{v}.png` → blur grueso, para el shader WebGL del agua
//     (el flow puede llegar hasta el filo de las rocas/orilla)
//   • `lake-mask-{v}.png`  → hard edge + polígono "inset" (línea de orilla
//     ~4% más abajo que la water mask), para los peces (no deben acercarse
//     al filo). Mismo patrón que en MK6 original: dos máscaras separadas.
// -----------------------------------------------------------------------------
async function buildMasks(v) {
  // Util — construye el SVG dado un polígono UV.
  const buildSvg = (poly) => {
    const pts = poly
      .map(([u, vv]) => `${(u * v.w).toFixed(1)},${(vv * v.h).toFixed(1)}`)
      .join(' ');
    return `
      <svg width="${v.w}" height="${v.h}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="black"/>
        <polygon points="${pts}" fill="white"/>
      </svg>
    `;
  };

  // ─── Water mask (shader) — blur moderado para feather en orilla ──────
  // Sigma 0.8% del lado menor — previa iteración era 1.5% pero generaba
  // un halo de blur que extendía el efecto del agua arriba de la línea
  // del polígono, cubriendo skyline y bordes de la roca → "el agua afecta
  // la roca/skyline". 0.8% (~17 px en phone 1080) da feather perceptible
  // pero contenido.
  const waterSigma = Math.max(2, Math.min(v.w, v.h) * 0.008);
  await sharp(Buffer.from(buildSvg(v.waterPoly)))
    .blur(waterSigma)
    .greyscale()
    .png({ compressionLevel: 9, palette: false })
    .toFile(join(OUT_DIR, `water-mask-${v.name}.png`));
  console.log(`  water-mask-${v.name}.png (sigma ${waterSigma.toFixed(1)}) ✓`);

  // ─── Lake mask (peces) — inset 4% Y + blur leve ──────────────────────
  // Inset: bajamos cada punto de la línea de orilla 0.04 en UV (zona blanca
  // ~4% más reducida). Mantenemos los puntos del borde (x=0/1 y y=1.0)
  // intactos así el polígono se cierra bien. El inset solo aplica a la
  // línea superior del agua (donde y < 0.95).
  const lakePoly = v.waterPoly.map(([u, vv]) =>
    vv < 0.95 ? [u, Math.min(0.98, vv + 0.04)] : [u, vv],
  );
  // Blur leve (~0.4% del lado menor) — soft edge para que sampleMask
  // tenga un gradient corto en la transición de pez-puede-nadar a no.
  const lakeSigma = Math.max(1, Math.min(v.w, v.h) * 0.004);
  await sharp(Buffer.from(buildSvg(lakePoly)))
    .blur(lakeSigma)
    .greyscale()
    .png({ compressionLevel: 9, palette: false })
    .toFile(join(OUT_DIR, `lake-mask-${v.name}.png`));
  console.log(`  lake-mask-${v.name}.png  (sigma ${lakeSigma.toFixed(1)}) ✓`);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`OUT_DIR: ${OUT_DIR}\n`);

  for (const v of VARIANTS) {
    console.log(`[${v.name}]`);
    await convertImage(v);
    await buildMasks(v);
    console.log();
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
