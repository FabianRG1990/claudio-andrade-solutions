// Extrae las texturas embebidas del GLB del pez para inspeccion visual.
// Las texturas viven en chunks BIN del GLB y se referencian via accessor.
// Usamos parser manual minimo (no @gltf-transform — no esta instalado).
//
// Uso: node scripts/extract-glb-textures.mjs

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const PATH = 'apps/claudio-andrade-solutions/public/hero-wolf/fish-model.glb';
const OUT_DIR = 'scripts/_glb-textures';

await mkdir(OUT_DIR, { recursive: true });

const buf = await readFile(PATH);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen).replace(/\0+$/, ''));
// BIN chunk header at offset 20 + jsonLen
const binChunkStart = 20 + jsonLen;
const binLen = buf.readUInt32LE(binChunkStart);
const binDataStart = binChunkStart + 8;

console.log(`Images: ${json.images?.length ?? 0}`);

for (let i = 0; i < (json.images?.length ?? 0); i++) {
  const img = json.images[i];
  const bv = json.bufferViews[img.bufferView];
  const start = binDataStart + (bv.byteOffset ?? 0);
  const data = buf.slice(start, start + bv.byteLength);
  const ext = img.mimeType?.includes('jpeg') ? 'jpg' : 'png';
  const outPath = `${OUT_DIR}/tex-${i}.${ext}`;
  await writeFile(outPath, data);
  console.log(`  → ${outPath} (${(data.length / 1024).toFixed(1)} KB, mime=${img.mimeType})`);
}
