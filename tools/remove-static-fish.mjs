// Remueve los puntos bioluminiscentes estáticos del PNG MK3 — los que
// vienen pintados en la imagen original. Solo dejamos los peces
// animados que dibuja el canvas.
//
// Estrategia:
//   1) Identificamos pixels "brillantes" dentro del lago (mask > 0.5 +
//      luminance > threshold). El agua del MK3 es muy oscura (~rgb 8-30
//      en luminance), así que cualquier pixel sobre 60 es un destello.
//   2) Cluster por flood-fill para detectar cada punto individual.
//   3) Por cada cluster, calculamos un radius con margen y reemplazamos
//      cada pixel del cluster por el promedio del anillo de pixels OUT
//      del cluster (mismo radius + 4px). Eso da inpaint que matchea el
//      tono local del agua (más oscuro al fondo, más claro al frente).
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const heroPath = resolve(__dirname, '..', 'apps/claudio-andrade-solutions/public/hero-wolf/hero-mk3.png');
const maskPath = resolve(__dirname, '..', 'apps/claudio-andrade-solutions/public/hero-wolf/lake-mask-mk3.png');
// Output ahora pisa el original. Si necesitás comparar, hay backup en
// `hero-mk3.original.png` (creado manualmente antes de re-correr).
const outPath = resolve(__dirname, '..', 'apps/claudio-andrade-solutions/public/hero-wolf/hero-mk3.png');

const hero = PNG.sync.read(readFileSync(heroPath));
const mask = PNG.sync.read(readFileSync(maskPath));
const W = hero.width, H = hero.height;
console.log(`Image: ${W}×${H}`);

// Solo capturamos pixels MUY brillantes (>110) — los puntos
// bioluminiscentes estáticos tienen un núcleo fuertísimo. Con esto
// ignoramos los reflejos de la ciudad en el agua (que son brillantes
// pero más diluidos) y los micro-highlights de olas.
const BRIGHT_THRESHOLD = 110;
// También filtramos por tono: los peces estáticos son AZUL muy
// saturado (B mucho mayor que R). Reflejos del skyline son blanco-
// amarillento (R ≈ G ≈ B). Solo procesamos pixels con B - R > 50.
const BLUE_DOMINANCE = 50;
const inLake = (x, y) => mask.data[(y * W + x) * 4] > 128;
const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// Escanear y marcar bright pixels — luminance > 110 AND B - R > 50.
const isBright = new Uint8Array(W * H);
let brightCount = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!inLake(x, y)) continue;
    const i = (y * W + x) * 4;
    const r = hero.data[i];
    const b = hero.data[i + 2];
    const lum = luminance(r, hero.data[i + 1], b);
    if (lum > BRIGHT_THRESHOLD && b - r > BLUE_DOMINANCE) {
      isBright[y * W + x] = 1;
      brightCount++;
    }
  }
}
console.log(`Bright pixels in lake (lum>${BRIGHT_THRESHOLD}, B-R>${BLUE_DOMINANCE}): ${brightCount}`);

// Flood fill 8-connected para identificar clusters.
const visited = new Uint8Array(W * H);
const clusters = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = y * W + x;
    if (!isBright[idx] || visited[idx]) continue;
    // BFS
    const stack = [[x, y]];
    const cluster = [];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const ci = cy * W + cx;
      if (visited[ci] || !isBright[ci]) continue;
      visited[ci] = 1;
      cluster.push([cx, cy]);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (!visited[ny * W + nx] && isBright[ny * W + nx]) stack.push([nx, ny]);
        }
      }
    }
    // Solo procesamos clusters grandes (>= 20 pixels) — los peces
    // estáticos tienen un núcleo de >50 pixels brillantes; algo con
    // <20 son micro-highlights que NO queremos tocar.
    if (cluster.length >= 20) clusters.push(cluster);
  }
}
console.log(`Clusters found: ${clusters.length}`);

// Para cada cluster, inpaint con el promedio de un anillo exterior.
const RING_PAD = 10;     // grosor del anillo de muestra (px fuera del cluster)
const REPLACE_PAD = 18;  // expansión del cluster antes de reemplazar — los
                         // halos bioluminiscentes se extienden bastante
                         // más que el core brillante, hay que cubrirlos.

for (const cluster of clusters) {
  // Bounding box
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (const [x, y] of cluster) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const r = Math.max(maxX - minX, maxY - minY) / 2 + REPLACE_PAD;

  // Sample ring outside the cluster — exclude any pixel inside the
  // expanded radius. Average those into a single replacement color.
  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  const sampleR = r + RING_PAD;
  const sampleR2 = sampleR * sampleR;
  const insideR2 = (r + 1) * (r + 1);
  const xMin = Math.max(0, Math.floor(cx - sampleR));
  const xMax = Math.min(W - 1, Math.ceil(cx + sampleR));
  const yMin = Math.max(0, Math.floor(cy - sampleR));
  const yMax = Math.min(H - 1, Math.ceil(cy + sampleR));
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < insideR2 || d2 > sampleR2) continue;
      // Solo muestreamos pixels NO brillantes (no queremos tomar otro
      // bright spot vecino como muestra).
      if (isBright[y * W + x]) continue;
      const i = (y * W + x) * 4;
      sumR += hero.data[i];
      sumG += hero.data[i + 1];
      sumB += hero.data[i + 2];
      n++;
    }
  }
  if (n === 0) continue;
  const avgR = Math.round(sumR / n);
  const avgG = Math.round(sumG / n);
  const avgB = Math.round(sumB / n);

  // Reemplazar el cluster + halo con el color promedio. Para un blend
  // suave, usamos un fade radial — dentro del cluster el reemplazo es
  // 100%, en el anillo de halo decae a 0%.
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > insideR2) continue;
      const t = Math.sqrt(d2) / r;
      // Inside (t<1): blend completo. Edge (t=1): fade out.
      const alpha = Math.min(1, Math.max(0, 1 - t * 0.6));
      const i = (y * W + x) * 4;
      hero.data[i]     = Math.round(hero.data[i]     * (1 - alpha) + avgR * alpha);
      hero.data[i + 1] = Math.round(hero.data[i + 1] * (1 - alpha) + avgG * alpha);
      hero.data[i + 2] = Math.round(hero.data[i + 2] * (1 - alpha) + avgB * alpha);
    }
  }
  console.log(`  cluster cx=${cx.toFixed(0)} cy=${cy.toFixed(0)} r=${r.toFixed(0)}  inpaint avg=rgb(${avgR},${avgG},${avgB})`);
}

writeFileSync(outPath, PNG.sync.write(hero));
console.log(`\nWrote: ${outPath}`);
