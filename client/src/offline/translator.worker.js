// Offline translation worker: ONNX Runtime Web (WASM) + int8 models from the Cache API: IndicTrans2 for the
// Indian languages (~250-360 MB per bundle) and OPUS-MT / Marian for the world languages (~110-135 MB per direction).
// Only one model bundle is held in memory at a time.
import * as ort from 'onnxruntime-web/wasm';
import { Tokenizer } from '@huggingface/tokenizers';
import { BUNDLES, readFile } from './store.js';
import { createModel } from './model.js';
import { createMarianModel } from './marian.js';
import { preprocess, postprocess } from '../lib/indic.js';

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1; // external-data models + no cross-origin isolation requirement
ort.env.wasm.proxy = false;

let current = null; // { id, model }

async function loadMarian(id, report) {
  report('Reading model files…');
  const [cfg, tokJson, tokCfg] = await Promise.all([
    readFile(id, 'config.json', 'json'),
    readFile(id, 'tokenizer.json', 'json'),
    readFile(id, 'tokenizer_config.json', 'json'),
  ]);
  const tok = new Tokenizer(tokJson, tokCfg);
  const create = async (name) =>
    ort.InferenceSession.create(await readFile(id, name), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  report('Starting the encoder…');
  const enc = await create('encoder_model_int8.onnx');
  report('Starting the decoder…');
  const dec = await create('decoder_model_merged_int8.onnx');
  return createMarianModel({ Tensor: ort.Tensor, enc, dec, tok, cfg });
}

async function loadBundle(id, report) {
  if (current?.id === id) return current.model;
  current = null; // drop references so the previous sessions can be garbage collected
  if (!BUNDLES[id]) throw new Error(`Unknown model bundle ${id}`);
  if (BUNDLES[id].kind === 'marian') {
    const model = await loadMarian(id, report);
    current = { id, model };
    return model;
  }

  report('Reading model files…');
  const [meta, gen, srcJson, tgtJson] = await Promise.all([
    readFile(id, 'tokenizer_meta.json', 'json'),
    readFile(id, 'generation_config.json', 'json'),
    readFile(id, 'tokenizer_src.json', 'json'),
    readFile(id, 'tokenizer_tgt.json', 'json'),
  ]);
  const srcTok = new Tokenizer(srcJson, {});
  const tgtTok = new Tokenizer(tgtJson, {});

  const create = async (graph, dataName, data) => {
    const graphBytes = await readFile(id, graph);
    return ort.InferenceSession.create(graphBytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      externalData: [{ path: dataName, data }],
    });
  };

  report('Starting the encoder…');
  const enc = await create('encoder_model.onnx', 'encoder_model.onnx.data', await readFile(id, 'encoder_model.onnx.data'));
  report('Starting the decoder…');
  // Both decoder graphs share one weights file (~200 MB): read it once instead of once per session.
  const shared = await readFile(id, 'decoder_shared.onnx.data');
  const dec = await create('decoder_model.onnx', 'decoder_shared.onnx.data', shared);
  const decPast = await create('decoder_with_past_model.onnx', 'decoder_shared.onnx.data', shared);

  const model = createModel({ Tensor: ort.Tensor, enc, dec, decPast, srcTok, tgtTok, meta, gen });
  current = { id, model };
  return model;
}

const cancelled = new Set();

async function translate({ id, chunks, steps }, report, progress) {
  const signal = { get aborted() { return cancelled.has(id); } };
  let texts = chunks;
  for (let s = 0; s < steps.length; s++) {
    const { bundle, src, tgt } = steps[s];
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const model = await loadBundle(bundle, report);
    const marian = BUNDLES[bundle].kind === 'marian';
    const out = [];
    for (let i = 0; i < texts.length; i++) {
      progress((s + i / texts.length) / steps.length);
      if (marian) {
        // OPUS-MT works on plain text: no Indic script mapping or entity placeholders.
        out.push(await model.translate(texts[i], { signal }));
        continue;
      }
      const { text: pre, entities } = preprocess(texts[i], src);
      const raw = await model.translate(pre, src, tgt, { signal });
      out.push(postprocess(raw, tgt, entities));
    }
    texts = out;
  }
  progress(1);
  return texts;
}

// Sessions can't run concurrently, so jobs are queued; a 'cancel' message aborts a queued/running job.
let queue = Promise.resolve();

self.onmessage = ({ data }) => {
  const { id, type } = data;
  if (type === 'cancel') {
    cancelled.add(data.target);
    return;
  }
  const post = (msg) => self.postMessage({ id, ...msg });
  queue = queue.then(async () => {
    try {
      if (type === 'translate') {
        const translations = await translate(
          data,
          (message) => post({ type: 'status', message }),
          (value) => post({ type: 'progress', value }),
        );
        post({ type: 'done', translations });
      } else if (type === 'unload') {
        current = null;
        post({ type: 'done' });
      }
    } catch (err) {
      if (err?.name !== 'AbortError') current = null;
      post({ type: 'error', message: err?.name === 'AbortError' ? 'cancelled' : err?.message || String(err), cancelled: err?.name === 'AbortError' });
    } finally {
      cancelled.delete(id);
    }
  });
};
