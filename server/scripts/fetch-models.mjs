// Downloads the on-device translation models (IndicTrans2 int8 ONNX, MIT licence) from Hugging Face into
// MODELS_DIR (default: server/models), where the server mirrors them at /models/<bundle>/<file>.
//
//   node scripts/fetch-models.mjs              download everything that is missing (~900 MB)
//   node scripts/fetch-models.mjs en-indic     only some bundles
//   node scripts/fetch-models.mjs --check      verify the remote URLs and sizes, download nothing
//
// Existing files with the right size are skipped, so it is safe to re-run after an interruption.
// The pack list (revisions and sizes) lives in src/models.js and must match client/src/offline/store.js.
// The running server can also fetch a pack on demand (POST /api/models/:id/prepare); both use the same code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLES, downloadTo, hfUrl } from '../src/models.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MODELS_DIR ? path.resolve(process.env.MODELS_DIR) : path.resolve(here, '../models');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const wanted = args.filter((a) => !a.startsWith('--'));
for (const w of wanted) if (!BUNDLES[w]) fail(`Unknown bundle "${w}". Choose from: ${Object.keys(BUNDLES).join(', ')}`);
const ids = wanted.length ? wanted : Object.keys(BUNDLES);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

async function remoteSize(u) {
  // Ask for one byte: the Content-Range header carries the full size even behind the CDN redirect.
  const res = await fetch(u, { headers: { Range: 'bytes=0-0' } });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const range = res.headers.get('content-range');
  return range ? Number(range.split('/')[1]) : Number(res.headers.get('content-length'));
}

let problems = 0;
for (const id of ids) {
  const b = BUNDLES[id];
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, size] of Object.entries(b.files)) {
    const dest = path.join(dir, name);
    const label = `${id}/${name} (${mb(size)})`;
    try {
      if (checkOnly) {
        const remote = await remoteSize(hfUrl(b, name));
        const ok = remote === size;
        if (!ok) problems++;
        console.log(`${ok ? 'ok      ' : 'MISMATCH'} ${label}${ok ? '' : ` remote=${remote}`}`);
      } else if (fs.existsSync(dest) && fs.statSync(dest).size === size) {
        console.log(`have     ${label}`);
      } else {
        console.log(`fetching ${label}`);
        await downloadTo(hfUrl(b, name), dest, size);
      }
    } catch (err) {
      problems++;
      console.error(`FAILED   ${label}: ${err.message}`);
    }
  }
}
if (problems) fail(`\n${problems} problem(s). Re-run to retry.`);
console.log(checkOnly ? '\nAll remote files match.' : `\nModels ready in ${OUT}`);
