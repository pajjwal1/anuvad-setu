// Splits text into pieces no longer than `max` (measured by `size`, default = characters)
// while keeping paragraph (newline) structure intact so it can be re-assembled after translation.

const SENTENCE_END = /(?<=[.!?。！？।॥؟…])\s+/u;

export const utf8Bytes = (s) => Buffer.byteLength(s, 'utf8');

/** Split one line into chunks <= max, preferring sentence, then word boundaries. */
export function chunkLine(line, max = 450, size = (s) => s.length) {
  if (size(line) <= max) return [line];
  const chunks = [];
  let current = '';
  const push = (piece) => {
    if (!piece) return;
    if (current && size(current) + 1 + size(piece) > max) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current} ${piece}` : piece;
  };

  for (const sentence of line.split(SENTENCE_END)) {
    if (size(sentence) <= max) {
      push(sentence);
      continue;
    }
    // Sentence itself too long: split on words, then hard-split by code point as a last resort.
    for (const word of sentence.split(/\s+/)) {
      if (size(word) <= max) {
        push(word);
        continue;
      }
      let piece = '';
      for (const ch of word) {
        if (piece && size(piece + ch) > max) {
          push(piece);
          piece = '';
        }
        piece += ch;
      }
      push(piece);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Turns text into a list of "segments". Each segment is either a literal
 * (whitespace / empty line, kept as-is) or a translatable chunk.
 */
export function segmentText(text, max = 450, size = (s) => s.length) {
  const segments = [];
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    if (line.trim() === '') {
      segments.push({ literal: line });
    } else {
      chunkLine(line.trim(), max, size).forEach((c, i) => {
        segments.push({ chunk: c, joinWithSpace: i > 0 });
      });
    }
    if (idx < lines.length - 1) segments.push({ literal: '\n' });
  });
  return segments;
}

export function assemble(segments, translations) {
  let out = '';
  let t = 0;
  for (const seg of segments) {
    if ('literal' in seg) {
      out += seg.literal;
    } else {
      out += (seg.joinWithSpace ? ' ' : '') + translations[t++];
    }
  }
  return out;
}
