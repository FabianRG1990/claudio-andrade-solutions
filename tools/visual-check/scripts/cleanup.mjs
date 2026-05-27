#!/usr/bin/env node
// cleanup.mjs
// Delete iteration screenshots and diff images from tools/visual-check/iterations/.
// Preserves .gitkeep and the reference/ folder.
// Usage:  node scripts/cleanup.mjs [--dry-run]

import { readdir, unlink, writeFile, stat } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ITERATIONS_DIR = resolve(__dirname, '..', 'iterations');

const dryRun = process.argv.includes('--dry-run');

// Patterns that should be cleaned (anything matching is deletable).
const DELETE_PATTERNS = [
  /^iter-\d+\.png$/i,
  /^diff-.*\.png$/i,
  /^card-tops-.*\.png$/i,
  /^scratch-.*\.png$/i,
  /^temp-.*\.png$/i,
  /^.*\.diff\.png$/i,
];

// Patterns to never delete.
const PRESERVE_PATTERNS = [
  /^\.gitkeep$/i,
  /^README\.md$/i,
];

function matchesAny(name, patterns) {
  return patterns.some((p) => p.test(name));
}

async function fileSize(path) {
  try { return (await stat(path)).size; } catch { return 0; }
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  console.log(`Cleaning ${ITERATIONS_DIR}`);
  if (dryRun) console.log('  (dry-run — no files will be deleted)');

  let files = [];
  try { files = await readdir(ITERATIONS_DIR); }
  catch (e) {
    console.log(`  ${ITERATIONS_DIR} does not exist. Nothing to clean.`);
    process.exit(0);
  }

  const toDelete = [];
  const preserved = [];
  const unknown = [];

  for (const f of files) {
    if (matchesAny(f, PRESERVE_PATTERNS)) { preserved.push(f); continue; }
    if (matchesAny(f, DELETE_PATTERNS))   { toDelete.push(f); continue; }
    unknown.push(f);
  }

  console.log(`  Found ${files.length} files`);
  console.log(`    ${toDelete.length} matching delete patterns`);
  console.log(`    ${preserved.length} preserved (.gitkeep / README)`);
  if (unknown.length) {
    console.log(`    ${unknown.length} UNKNOWN — review and adjust patterns if needed:`);
    for (const u of unknown) console.log(`      · ${u}`);
  }

  let bytes = 0;
  for (const f of toDelete) {
    const p = join(ITERATIONS_DIR, f);
    bytes += await fileSize(p);
    if (!dryRun) await unlink(p);
  }
  console.log(`  ${dryRun ? 'Would remove' : 'Removed'} ${toDelete.length} files (${fmtBytes(bytes)})`);

  // Ensure .gitkeep exists so the folder stays tracked in git.
  if (!dryRun && !preserved.includes('.gitkeep')) {
    await writeFile(join(ITERATIONS_DIR, '.gitkeep'), '');
    console.log('  + wrote .gitkeep');
  }

  console.log(dryRun ? 'Done (dry-run).' : 'Done. iterations/ is sanitized.');
}

main().catch((e) => { console.error(e); process.exit(1); });
