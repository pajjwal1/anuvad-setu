import { useCallback, useEffect, useRef, useState } from 'react';

/** Pick a voice that runs on the device (no network) for `lang`, or null. */
export function pickLocalVoice(voices, lang) {
  const base = String(lang).split('-')[0].toLowerCase();
  const matches = voices.filter((v) => v.localService && v.lang.toLowerCase().split(/[-_]/)[0] === base);
  return matches.find((v) => v.lang.toLowerCase().replace('_', '-') === String(lang).toLowerCase()) || matches[0] || null;
}

/**
 * Speak text. With `localOnly` (private mode) only an on-device voice is used; some browsers otherwise send
 * the text to a cloud voice. Returns false when nothing was spoken (e.g. no local voice for this language).
 */
export function speak(text, lang, { localOnly = false } = {}) {
  if (!('speechSynthesis' in window) || !text) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  if (localOnly) {
    const voice = pickLocalVoice(window.speechSynthesis.getVoices(), lang);
    if (!voice) return false;
    u.voice = voice;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return true;
}

export const canSpeak = () => 'speechSynthesis' in window;

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const canListen = !!Recognition;

/** Speech-to-text (browser support varies; Chrome/Edge/Safari need a network for recognition). */
export function useDictation(lang, onText) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);

  const stop = useCallback(() => ref.current?.stop(), []);

  const start = useCallback(() => {
    if (!Recognition) return;
    setError('');
    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = false;
    rec.onresult = (e) => onText(Array.from(e.results).map((r) => r[0].transcript).join(' '));
    rec.onerror = (e) => setError(e.error === 'not-allowed' ? 'Microphone permission denied.' : `Voice input: ${e.error}`);
    rec.onend = () => setListening(false);
    ref.current = rec;
    setListening(true);
    rec.start();
  }, [lang, onText]);

  useEffect(() => () => ref.current?.abort(), []);

  return { listening, error, start, stop };
}
