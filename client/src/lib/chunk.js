// Client copy of the text chunker (kept in sync with server/src/chunk.js).
// On-device models handle ~512 tokens, so long text is translated sentence-group by sentence-group.

const SENTENCE_END = /(?<=[.!?。！？।؟…])\s+/u;

export function chunkLine(line, max = 300) {
  if (line.length <= max) return [line];
  const chunks = [];
  let current = '';
  const push = (piece) => {
    if (!piece) return;
    if (current && current.length + 1 + piece.length > max) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current} ${piece}` : piece;
  };
  for (const sentence of line.split(SENTENCE_END)) {
    if (sentence.length <= max) {
      push(sentence);
      continue;
    }
    for (const word of sentence.split(/\s+/)) {
      if (word.length <= max) push(word);
      else for (let i = 0; i < word.length; i += max) push(word.slice(i, i + max));
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function segmentText(text, max = 300) {
  const segments = [];
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (line.trim() === '') segments.push({ literal: line });
    else chunkLine(line.trim(), max).forEach((c, i) => segments.push({ chunk: c, joinWithSpace: i > 0 }));
    if (idx < lines.length - 1) segments.push({ literal: '\n' });
  });
  return segments;
}

export function assemble(segments, translations) {
  let out = '';
  let t = 0;
  for (const seg of segments) {
    if ('literal' in seg) out += seg.literal;
    else out += (seg.joinWithSpace ? ' ' : '') + translations[t++];
  }
  return out;
}
