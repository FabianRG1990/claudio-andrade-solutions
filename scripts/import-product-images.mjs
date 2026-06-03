// Read the five new product images from Downloads, log their native size,
// then write optimized AVIF + WebP variants into apps/.../public/productos/.
// Filename convention: match the slug used in data.ts (image swap is done
// via .replace('.png', '.avif|.webp') at runtime).
//
// User constraint: "no zoom, no acercamiento" → we do NOT resize/crop.
// We keep native dimensions and write quality-tuned WebP/AVIF only.

import sharp from 'sharp';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'C:/Users/Fabian/Downloads';
const DST = 'apps/claudio-andrade-solutions/public/productos';

// productName-in-card → slug used in data.ts (which becomes the filename)
const MAP = [
  { src: 'sistemas a medida.png',            slug: 'auditoria-tecnologica' }, // name "Sistemas a medida"
  { src: 'landing premium.png',              slug: 'sistemas-a-medida' },     // name "Landing premium"
  { src: 'integracion de ia.png',            slug: 'integraciones-ia' },      // name "Integraciones de IA"
  { src: 'apps para proveedores de walmart.png', slug: 'apps-walmart' },      // name "Apps Para proveedores de Walmart"
  { src: 'auditoria de tecnologia.png',      slug: 'landing-premium' },       // name "Auditoría de tecnología"
];

for (const { src, slug } of MAP) {
  const inFile = path.join(SRC, src);
  const meta = await sharp(inFile).metadata();
  console.log(`${src} → ${meta.width}×${meta.height} (ratio ${(meta.width / meta.height).toFixed(3)})`);

  // Write WebP — quality 82 is a good balance for screenshots / UI mocks.
  // No resize: keep native dimensions per user request ("tamaño original").
  await sharp(inFile)
    .webp({ quality: 82, effort: 5 })
    .toFile(path.join(DST, `${slug}.webp`));

  // Write AVIF — better compression at similar visual quality.
  await sharp(inFile)
    .avif({ quality: 60, effort: 5 })
    .toFile(path.join(DST, `${slug}.avif`));

  console.log(`   → wrote ${slug}.webp + ${slug}.avif`);
}

console.log('\nDone.');
