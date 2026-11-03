// Copie les ressources OCR (tesseract.js) dans public/vendor pour un usage hors CDN
// (requis par COEP require-corp et par les builds Tauri/Capacitor hors-ligne).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = join(process.cwd(), 'public', 'vendor', 'tesseract');
mkdirSync(out, { recursive: true });

const tesseractDist = dirname(require.resolve('tesseract.js/dist/worker.min.js'));
cpSync(join(tesseractDist, 'worker.min.js'), join(out, 'worker.min.js'));

const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
mkdirSync(join(out, 'core'), { recursive: true });
for (const file of [
  'tesseract-core.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
]) {
  const src = join(coreDir, file);
  if (existsSync(src)) cpSync(src, join(out, 'core', file));
}
console.log('[copy-vendor] tesseract ->', out);
