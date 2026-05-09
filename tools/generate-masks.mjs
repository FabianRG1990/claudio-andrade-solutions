// Genera las máscaras necesarias para el hero animado de MK3:
//   - lake-mask-mk3.png: blanco donde los peces pueden nadar (lago),
//     negro donde no (cielo, montañas, rocas, lobo, árboles)
//   - wolf-mask-mk3.png: blanco solo en el silueta del lobo (para
//     animación de respiración con scale en una capa enmascarada)
//   - city-mask-mk3.png: blanco donde están las luces de la ciudad
//     (para parpadeo CSS encima)
//
// Los polígonos están definidos en coordenadas de la imagen MK3 (1672×941).
// Si el usuario regenera el PNG con otro encuadre, hay que retocar los
// vértices acá — la geometría no se auto-detecta para mantener control.
import { PNG } from 'pngjs';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'apps/claudio-andrade-solutions/public/hero-wolf');

const W = 1672;
const H = 941;

// Polígono del lago — en coordenadas de la imagen MK3.
// Recorrido: empezamos en la esquina sup-izq del agua (orilla izquierda
// donde los árboles tocan el agua), seguimos la línea del horizonte
// hacia la derecha, bordeamos la roca del lobo con una curva, y cerramos
// por la base de la imagen.
// Nota: en MK3 el horizonte está aprox en y=425, y la roca del lobo
// jadea hacia el agua entre x≈1090 y x≈1530.
// Polígono trazado a partir de la línea roja del usuario sobre el screenshot.
// Línea horizontal alta en y≈510 desde el borde izquierdo hasta justo antes
// del borde izquierdo de la roca (x≈1000). Caída casi vertical en la cara
// izquierda de la roca, curva siguiendo la base del reflejo del lobo, y
// corte agresivo en el lado derecho del lago para que el pez nunca entre
// en el área del reflejo opaco de la roca.
const LAKE_POLYGON = [
  // Borde superior — horizonte limpio del lago.
  [   0,  510],
  [ 200,  510],
  [ 400,  508],
  [ 600,  508],
  [ 800,  510],
  [1000,  510],
  // Caída casi vertical en la cara izquierda de la roca del lobo —
  // sigue la línea roja que el usuario trazó.
  [1015,  555],
  [1035,  605],
  [1080,  655],
  [1140,  695],
  // Curva siguiendo la base del reflejo del lobo en el agua.
  [1220,  720],
  [1300,  735],
  [1380,  745],
  [1460,  748],
  [1500,  748],
  // Corte agresivo en el lado derecho — el reflejo se extiende hasta el
  // borde derecho del lago. Bajamos vertical a la base de la imagen
  // para excluir todo el strip derecho.
  [1510,  941],
  // Cierre por la base hacia la izquierda.
  [   0,  941],
];

// Punto-en-polígono (algoritmo ray casting). Trabaja en floats para
// soportar muestreo subpixel para anti-alias del borde.
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Renderiza el polígono a un PNG grayscale con anti-aliasing 4×4.
// Cada pixel del output muestrea 16 puntos dentro de su área y promedia
// el resultado — bordes suaves sin postprocess de blur.
function renderPolygonMask(poly, width, height) {
  const png = new PNG({ width, height });
  const data = png.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let inside = 0;
      // 4×4 supersample
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4;
          const py = y + (sy + 0.5) / 4;
          if (pointInPolygon(px, py, poly)) inside++;
        }
      }
      const v = Math.round((inside / 16) * 255);
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return png;
}

console.log('[1/3] Renderizando lake mask MK3 (1672×941, supersample 4x4)...');
console.time('  render');
const lakeMask = renderPolygonMask(LAKE_POLYGON, W, H);
console.timeEnd('  render');

const lakePath = resolve(outDir, 'lake-mask-mk3.png');
writeFileSync(lakePath, PNG.sync.write(lakeMask));
console.log('  ->', lakePath);

// Bounding box del lago para clipping rápido del canvas en runtime.
let minX = W, minY = H, maxX = 0, maxY = 0;
for (const [x, y] of LAKE_POLYGON) {
  if (x < minX) minX = x;
  if (y < minY) minY = y;
  if (x > maxX) maxX = x;
  if (y > maxY) maxY = y;
}
console.log('\n[2/3] Lake bounding box:');
console.log(`  x: ${minX}..${maxX}  (${maxX - minX}px wide)`);
console.log(`  y: ${minY}..${maxY}  (${maxY - minY}px tall)`);
console.log(`  normalized: x:${(minX/W).toFixed(3)}..${(maxX/W).toFixed(3)}  y:${(minY/H).toFixed(3)}..${(maxY/H).toFixed(3)}`);

console.log('\n[3/3] Done. Inspect lake-mask-mk3.png to verify polygon.');
