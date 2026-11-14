// Marian (OPUS-MT) inference core for the world-language packs (environment independent, like model.js:
// ONNX Runtime and the tokenizer are injected, so the same code runs in the browser worker and in Node tests).
//
// Encoder once, then a greedy decoder loop on the single "merged" decoder graph: `use_cache_branch` is false on
// the first step (empty past) and true afterwards (past fed from the previous `present.*` outputs).

const big = (a) => BigInt64Array.from(a, (n) => BigInt(n));
const KV = ['decoder.key', 'decoder.value', 'encoder.key', 'encoder.value'];

/**
 * @param {object} m
 *  Tensor              ort Tensor constructor
 *  enc, dec            inference sessions (encoder_model, decoder_model_merged)
 *  tok                 @huggingface/tokenizers instance
 *  cfg {decoder_attention_heads, d_model, decoder_start_token_id, eos_token_id, pad_token_id}
 */
export function createMarianModel(m) {
  const heads = m.cfg.decoder_attention_heads;
  const headDim = m.cfg.d_model / heads;
  const eos = m.cfg.eos_token_id ?? 0;
  const pad = m.cfg.pad_token_id;
  const start = m.cfg.decoder_start_token_id ?? pad;
  const layers = m.dec.inputNames.filter((n) => /^past_key_values\.\d+\.decoder\.key$/.test(n)).length;
  const t64 = (arr) => new m.Tensor('int64', big(arr), [1, arr.length]);
  const empty = () => new m.Tensor('float32', new Float32Array(0), [1, heads, 0, headDim]);

  /** `prefix` is the ">>fra<<" style target-language token that some multi-target models need (else ''). */
  async function translate(text, { prefix = '', signal } = {}) {
    const src = m.tok.encode(prefix ? `${prefix} ${text}` : text);
    const ids = src.ids;
    const attn = t64(src.attention_mask ?? ids.map(() => 1));
    const encOut = await m.enc.run({ input_ids: t64(ids), attention_mask: attn });

    const maxNew = Math.min(256, ids.length * 3 + 10);
    const out = [];
    let cur = t64([start]);
    let past = null;
    for (let step = 0; step < maxNew; step++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const feed = {
        input_ids: cur,
        encoder_hidden_states: encOut.last_hidden_state,
        encoder_attention_mask: attn,
        use_cache_branch: new m.Tensor('bool', [step > 0], [1]),
      };
      for (let i = 0; i < layers; i++) {
        for (const k of KV) feed[`past_key_values.${i}.${k}`] = past ? past[`${i}.${k}`] : empty();
      }
      const o = await m.dec.run(feed);
      const next = {};
      for (let i = 0; i < layers; i++) {
        for (const k of KV) {
          const fresh = o[`present.${i}.${k}`];
          // With the cache branch on, the encoder key/values come back empty: keep the ones from step 0.
          next[`${i}.${k}`] = step > 0 && k.startsWith('encoder') ? past[`${i}.${k}`] : fresh;
        }
      }
      past = next;

      const { data, dims } = o.logits;
      const V = dims[2];
      const off = (dims[1] - 1) * V;
      let best = 0;
      let bv = -Infinity;
      for (let v = 0; v < V; v++) {
        if (v === pad) continue; // the model must never emit its padding / start token
        if (data[off + v] > bv) {
          bv = data[off + v];
          best = v;
        }
      }
      if (best === eos) break;
      out.push(best);
      cur = t64([best]);
    }
    return m.tok.decode(out, { skip_special_tokens: true });
  }

  return { translate };
}
