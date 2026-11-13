// Copies the ONNX Runtime Web WASM files into public/ort so they are served from our own origin
// (needed for offline use; avoids loading from a CDN). Only the plain-WASM build is used.
import { copyFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/onnxruntime-web/dist');
const out = resolve(root, 'public/ort');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) rmSync(resolve(out, f)); // drop stale files from older runtimes

for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  if (!existsSync(resolve(src, f))) throw new Error(`Missing ${f} in ${src}`);
  copyFileSync(resolve(src, f), resolve(out, f));
}
console.log('ONNX runtime files copied to public/ort');
