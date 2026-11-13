// IndicTrans2 inference core (environment independent: ONNX Runtime and the tokenizers are injected,
// so the same code runs in the browser worker and in Node tests).
//
// Encoder once, then a greedy decoder loop: step 0 with decoder_model, later steps with
// decoder_with_past_model fed from the `present.*` key/value tensors of the previous step.

const KV = ['decoder.key', 'decoder.value', 'encoder.key', 'encoder.value'];
const big = (a) => BigInt64Array.from(a, (n) => BigInt(n));

/**
 * @param {object} m
 *  Tensor        ort Tensor constructor
 *  enc, dec, decPast   inference sessions
 *  srcTok, tgtTok      @huggingface/tokenizers instances
 *  meta {src_dict_size,tgt_dict_size,unk_id}, gen {eos_token_id,decoder_start_token_id}
 */
export function createModel(m) {
  const eos = m.gen.eos_token_id ?? 2;
  const start = m.gen.decoder_start_token_id ?? 2;
  const layers = (m.dec.outputNames.length - 1) / 4;
  const tagCache = new Map();

  const tagId = (tag) => {
    if (!tagCache.has(tag)) tagCache.set(tag, m.srcTok.encode(tag, { add_special_tokens: false }).ids[0]);
    return tagCache.get(tag);
  };
  const t64 = (arr) => new m.Tensor('int64', big(arr), [1, arr.length]);

  async function translate(text, srcTag, tgtTag, { signal } = {}) {
    const enc = m.srcTok.encode(text.startsWith(' ') ? text : ` ${text}`);
    const ids = [tagId(srcTag), tagId(tgtTag), ...enc.ids].map((i) => (i < m.meta.src_dict_size ? i : m.meta.unk_id));
    const mask = [1, 1, ...enc.attention_mask];
    const attn = t64(mask);
    const encOut = await m.enc.run({ input_ids: t64(ids), attention_mask: attn });

    const maxNew = Math.min(256, ids.length * 3 + 10);
    const out = [start];
    let cur = t64([start]);
    let past = null;
    for (let step = 0; step < maxNew; step++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      let o;
      if (step === 0) {
        o = await m.dec.run({ input_ids: cur, encoder_hidden_states: encOut.last_hidden_state, encoder_attention_mask: attn });
        past = o;
      } else {
        const feed = {};
        for (let i = 0; i < layers; i++) for (const k of KV) feed[`past_key_values.${i}.${k}`] = past[`present.${i}.${k}`];
        o = await m.decPast.run({ input_ids: cur, encoder_attention_mask: attn, ...feed });
        for (let i = 0; i < layers; i++) {
          past[`present.${i}.decoder.key`] = o[`present.${i}.decoder.key`];
          past[`present.${i}.decoder.value`] = o[`present.${i}.decoder.value`];
          if (o[`present.${i}.encoder.key`]) {
            past[`present.${i}.encoder.key`] = o[`present.${i}.encoder.key`];
            past[`present.${i}.encoder.value`] = o[`present.${i}.encoder.value`];
          }
        }
      }
      const { data, dims } = o.logits;
      const V = dims[2];
      const off = (dims[1] - 1) * V;
      let best = 0;
      let bv = -Infinity;
      for (let v = 0; v < V; v++) {
        if (data[off + v] > bv) {
          bv = data[off + v];
          best = v;
        }
      }
      out.push(best);
      if (best === eos) break;
      cur = t64([best]);
    }
    const safe = out.map((i) => (i < m.meta.tgt_dict_size ? i : m.meta.unk_id));
    return m.tgtTok.decode(safe, { skip_special_tokens: true });
  }

  return { translate };
}
