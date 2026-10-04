#!/usr/bin/env node
/**
 * Asset pipeline: raw 3D sources in assets-src/ → web-ready files in public/.
 *
 *   assets-src/models/*.glb|*.gltf  →  public/models/<name>.glb
 *       meshopt geometry compression, WebP textures capped at 2048 px,
 *       deduped/pruned/welded via `gltf-transform optimize`.
 *
 * Textures for shader materials (planet maps etc.) are exported to
 * public/textures/ as WebP by hand; this script reports anything over budget.
 *
 * assets-src/ is git-ignored: commit only the optimized output and add every
 * third-party file to CREDITS.md before committing it.
 *
 * Usage: npm run assets:optimize            (all models)
 *        npm run assets:optimize -- rocket  (only files whose name contains "rocket")
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_MODELS = path.join(ROOT, 'assets-src', 'models');
const OUT_MODELS = path.join(ROOT, 'public', 'models');
const OUT_TEXTURES = path.join(ROOT, 'public', 'textures');

// Per-file budgets in bytes (see the blueprint's asset table).
const MODEL_BUDGET = 2.5 * 1024 * 1024;
const TEXTURE_BUDGET = 1.5 * 1024 * 1024;

const filter = process.argv[2]?.toLowerCase();
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

function optimizeModels() {
  if (!existsSync(SRC_MODELS)) {
    console.log(`No ${path.relative(ROOT, SRC_MODELS)}/ folder; nothing to optimize.`);
    return;
  }
  mkdirSync(OUT_MODELS, { recursive: true });

  const sources = readdirSync(SRC_MODELS)
    .filter((file) => /\.(glb|gltf)$/i.test(file))
    .filter((file) => !filter || file.toLowerCase().includes(filter));

  for (const file of sources) {
    const input = path.join(SRC_MODELS, file);
    const output = path.join(OUT_MODELS, file.replace(/\.gltf$/i, '.glb'));
    console.log(`→ ${file}`);
    execFileSync(
      'npx',
      [
        '--yes', '@gltf-transform/cli', 'optimize', input, output,
        '--compress', 'meshopt',
        '--texture-compress', 'webp',
        '--texture-size', '2048',
      ],
      { stdio: 'inherit', shell: process.platform === 'win32' },
    );
    const size = statSync(output).size;
    const flag = size > MODEL_BUDGET ? '  ⚠ over budget' : '';
    console.log(`  ${kb(statSync(input).size)} → ${kb(size)}${flag}`);
  }
}

function auditTextures() {
  if (!existsSync(OUT_TEXTURES)) return;
  for (const file of readdirSync(OUT_TEXTURES)) {
    const size = statSync(path.join(OUT_TEXTURES, file)).size;
    if (size > TEXTURE_BUDGET) console.warn(`⚠ textures/${file} is ${kb(size)} (budget ${kb(TEXTURE_BUDGET)})`);
  }
}

optimizeModels();
auditTextures();
