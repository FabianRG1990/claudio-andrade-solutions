// Genera water-mask.png para el WolfLandscape:
//   blanco (255) = agua libre — las ondas viven y los peces nadan ahí
//   negro  (0)   = tierra/cielo/roca — barrera, las ondas rebotan
//   feather       = transición suave en orillas para que las ondas no rebotan en seco
//
// Estrategia: un polígono simple que define la zona del lago, sin heurística
// por pixel (la niebla es brillante y los reflejos de árboles son oscuros —
// cualquier filtro luma/sat falla). Un blur fuerte después de rasterizar el
// polígono produce el feather de las orillas que necesita el wave-field.

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(
  __dirname,
  '../../apps/claudio-andrade-solutions/public/hero-wolf',
);
const SRC = resolve(PUBLIC_DIR, 'fondo.jpg');
const OUT = resolve(PUBLIC_DIR, 'water-mask.png');

// ─── Polígono del lago en coords normalizadas (0..1, donde y=0 es top) ──
// Basado en inspección visual de fondo.jpg (2560×1440):
//   - Línea de horizonte (donde termina el bosque, empieza la superficie del
//     agua) está a Y≈0.41-0.44 según la X.
//   - La roca + lobo + sus reflejos ocupan la columna derecha desde X≈0.74
//     hasta el borde derecho. Se excluye toda esa columna del mask: las
//     ondas rebotan ahí, los peces no entran.
//   - El lago se extiende todo lo demás del borde inferior izquierdo.
//
// Polígono cerrado: arranca top-left, traza la línea del horizonte hacia
// la derecha hasta tocar la roca, baja por el borde izquierdo de la roca
// hasta el fondo, y vuelve por el borde inferior al inicio.
// El agua NO se limita al lado izquierdo de la roca. Debajo de la roca,
// donde se ve el reflejo del lobo invertido, también es agua. Así que el
// polígono entra por el horizonte, baja siguiendo la silueta de la roca
// (lado izquierdo, que tiene un bulto), pasa por debajo de la base de la
// roca (donde el reflejo del lobo brilla en el agua) y vuelve a subir por
// el lado derecho. Las pequeñas rocas del borde derecho-bajo se excluyen
// con una "muesca" en el borde derecho del polígono.
const WATER_POLY = [
  // Horizonte — base de los árboles, ligero descenso hacia el centro
  [0.000, 0.420],
  [0.100, 0.418],
  [0.220, 0.412],
  [0.350, 0.418],
  [0.480, 0.430],
  [0.560, 0.434],
  [0.620, 0.435],
  // Top-left de la roca (donde la roca emerge del agua, lado izquierdo)
  [0.745, 0.435],
  // Bulto izquierdo de la roca: la roca SE EXPANDE a la izquierda hacia el
  // medio de su altura visible — silueta del montículo sobre el agua.
  [0.700, 0.490],
  [0.640, 0.540],
  [0.610, 0.580],
  // Esquina inferior-izquierda de la roca (donde la roca toca el agua abajo)
  [0.605, 0.605],
  // Borde inferior de la roca — la línea de costa por debajo de la roca,
  // siguiendo donde el rock-platform termina y empieza el reflejo en agua.
  [0.640, 0.625],
  [0.700, 0.640],
  [0.760, 0.655],
  [0.840, 0.665],
  [0.920, 0.660],
  [1.000, 0.660],
  // Bajamos por el borde derecho — todo esto es agua (con reflejo del lobo)
  [1.000, 0.825],
  // Muesca para las rocas pequeñas del borde derecho-bajo
  [0.905, 0.825],
  [0.890, 0.870],
  [0.895, 0.930],
  [0.920, 0.955],
  [1.000, 0.960],
  // Cierre por borde inferior y vuelta al inicio
  [1.000, 1.000],
  [0.000, 1.000],
];

// Helpers ─────────────────────────────────────────────────────────────────
const pointInPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

const rgbToHsl = (r, g, b) => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  }
  return { s, l };
};

// ─── Generación ─────────────────────────────────────────────────────────
const main = async () => {
  const img = sharp(SRC);
  const meta = await img.metadata();
  const W = meta.width;
  const H = meta.height;

  // Bajamos resolución para el procesamiento — el mask se usa solo como
  // textura del wave-field/shader, no necesita 2560×1440.
  const TARGET_W = 1280;
  const TARGET_H = Math.round((H * TARGET_W) / W);

  const { data: rgb } = await img
    .resize(TARGET_W, TARGET_H, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // No necesitamos la imagen original — el mask se genera puramente del
  // polígono. Pero respetamos sus dimensiones para el target.
  void rgb;

  const mask = Buffer.alloc(TARGET_W * TARGET_H);

  for (let y = 0; y < TARGET_H; y++) {
    const ny = y / TARGET_H;
    for (let x = 0; x < TARGET_W; x++) {
      const nx = x / TARGET_W;
      mask[y * TARGET_W + x] = pointInPoly(nx, ny, WATER_POLY) ? 255 : 0;
    }
  }

  // Blur fuerte para feather amplio en orillas — el wave-field interpreta
  // los grises como "barrera blanda" y atenúa la altura proporcionalmente.
  // Sin esto las ondas rebotan en seco y se ve cortado.
  const out = await sharp(mask, {
    raw: { width: TARGET_W, height: TARGET_H, channels: 1 },
  })
    .blur(4) // sigma 4 → feather ~8-10 px en los bordes
    .png({ compressionLevel: 9 })
    .toBuffer();

  await sharp(out).toFile(OUT);

  console.log(`✓ Mask generado: ${OUT}`);
  console.log(`  Resolución: ${TARGET_W}×${TARGET_H}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
