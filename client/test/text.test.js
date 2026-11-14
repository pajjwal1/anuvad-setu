import test from 'node:test';
import assert from 'node:assert/strict';
import { romanize } from '../src/lib/romanize.js';
import { preprocess, postprocess, toDevanagari, fromDevanagari, asciiDigits, protectEntities, restoreEntities } from '../src/lib/indic.js';
import { planOffline, detectLanguage, INDIAN_LANGUAGES, bundlesNeeded, OFFLINE_WORLD_CODES } from '../src/lib/languages.js';
import { segmentText, assemble } from '../src/lib/chunk.js';

/* ---------------- romanization ---------------- */

const R = (t, script, lang) => romanize(t, script, lang);

test('romanize Hindi', () => {
  assert.equal(R('नमस्ते', 'Deva', 'hi'), 'namaste');
  assert.equal(R('भारत', 'Deva', 'hi'), 'bhaarat');
  assert.equal(R('आप कैसे हैं', 'Deva', 'hi'), 'aap kaise hain');
  assert.equal(R('धन्यवाद', 'Deva', 'hi'), 'dhanyavaad');
  assert.equal(R('मुझे पानी चाहिए', 'Deva', 'hi'), 'mujhe paanee chaahie');
  assert.equal(R('स्टेशन कहाँ है?', 'Deva', 'hi'), 'steshan kahaan hai?');
});

test('romanize Tamil / Telugu / Kannada / Malayalam keep the inherent vowel', () => {
  assert.equal(R('தமிழ்', 'Taml', 'ta'), 'tamizh');
  assert.equal(R('வணக்கம்', 'Taml', 'ta'), 'vanakkam');
  assert.equal(R('నమస్కారం', 'Telu', 'te'), 'namaskaaram');
  assert.equal(R('ಕನ್ನಡ', 'Knda', 'kn'), 'kannada');
  assert.equal(R('മലയാളം', 'Mlym', 'ml'), 'malayaalam');
});

test('romanize Bengali / Gujarati / Punjabi / Odia', () => {
  assert.equal(R('ধন্যবাদ', 'Beng', 'bn'), 'dhanyabaad');
  assert.equal(R('આભાર', 'Gujr', 'gu'), 'aabhaar');
  assert.equal(R('ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'Guru', 'pa'), 'sat sree akaal');
  // ଡ଼ is the retroflex flap (pronounced like "r"), so this reads "oriaa"; the English exonym is "Odia".
  assert.equal(R('ଓଡ଼ିଆ', 'Orya', 'or'), 'oriaa');
});

test('nukta letters romanize the same whether precomposed or decomposed', () => {
  // ड़ = U+095C (precomposed) vs ड + U+093C (decomposed); likewise क़ ज़ फ़
  for (const [pre, dec] of [['\u095c', '\u0921\u093c'], ['\u0958', '\u0915\u093c'], ['\u095b', '\u091c\u093c'], ['\u095e', '\u092b\u093c'], ['\u095d', '\u0922\u093c']]) {
    assert.equal(R(`बा${pre}ा`, 'Deva', 'hi'), R(`बा${dec}ा`, 'Deva', 'hi'));
  }
  assert.equal(R('लड़का', 'Deva', 'hi'), 'larkaa');
});

test('romanize leaves Latin text and digits alone, returns null for unsupported scripts', () => {
  assert.equal(R('hello 123', 'Deva', 'hi'), 'hello 123');
  assert.equal(R('१२३', 'Deva', 'hi'), '123');
  assert.equal(R('اردو', 'Arab', 'ur'), null);
});

/* ---------------- script mapping ---------------- */

test('toDevanagari / fromDevanagari round-trip for each Brahmic script', () => {
  const samples = { Beng: 'আমি ভালো আছি', Gujr: 'તમે કેમ છો', Guru: 'ਤੁਸੀਂ ਕਿਵੇਂ ਹੋ', Orya: 'ଆପଣ କେମିତି ଅଛନ୍ତି', Telu: 'మీరు ఎలా ఉన్నారు', Knda: 'ನೀವು ಹೇಗಿದ್ದೀರಿ', Mlym: 'സുഖമാണോ' };
  for (const [script, text] of Object.entries(samples)) {
    const dev = toDevanagari(text, script);
    assert.notEqual(dev, text);
    assert.equal(fromDevanagari(dev, script), text, `${script} should round-trip`);
  }
});

test('Devanagari is left unchanged and danda survives', () => {
  assert.equal(toDevanagari('यह है।', 'Deva'), 'यह है।');
  assert.equal(fromDevanagari('यह है।', 'Beng').endsWith('।'), true);
});

/* ---------------- pre / post processing ---------------- */

test('asciiDigits converts native digits', () => {
  assert.equal(asciiDigits('१२३ ৪৫৬ ௭௮௯'), '123 456 789');
});

test('entities are protected and restored, including mangled placeholders', () => {
  const { text, map } = protectEntities('Call me at 10:30 or mail me@example.com, price 3.50');
  assert.match(text, /<ID\d>/);
  assert.ok(!text.includes('10:30'));
  assert.equal(restoreEntities(text, map), 'Call me at 10:30 or mail me@example.com, price 3.50');
  assert.equal(restoreEntities('time < ID1 > now [id1]', new Map([[1, '10:30']])), 'time 10:30 now 10:30');
});

test('placeholders survive phonetic spellings of "ID" in Indic output', () => {
  const m = new Map([[1, '10:30']]);
  for (const bad of ['< आईडी1 >', '< आय. डी. 1 >', '<आयडी1>', '[ID1]', '< ID1 >', '<ID1']) {
    assert.equal(postprocess(`ट्रेन ${bad} पर है`, 'hin_Deva', m), 'ट्रेन 10:30 पर है', bad);
  }
  // Bengali: the model emits Devanagari-space text; the placeholder is restored, then the script is mapped back
  assert.equal(postprocess('ट्रेन < आईडी1 > पर', 'ben_Beng', m), 'ট্রেন 10:30 পর');
  assert.equal(postprocess('My train leaves at < ID1 > .', 'eng_Latn', m), 'My train leaves at 10:30.');
});

test('preprocess splits punctuation; postprocess rejoins it (English)', () => {
  const { text, entities } = preprocess('Hello, how are you?', 'eng_Latn');
  assert.equal(text, 'Hello , how are you ?');
  assert.equal(postprocess('Hello , how are you ?', 'eng_Latn', entities), 'Hello, how are you?');
});

test('preprocess maps Tamil to Devanagari; postprocess maps back and detokenizes', () => {
  const { text } = preprocess('வணக்கம், எப்படி இருக்கிறீர்கள்?', 'tam_Taml');
  assert.ok(/[\u0900-\u097f]/.test(text) && !/[\u0b80-\u0bff]/.test(text));
  const back = postprocess(toDevanagari('வணக்கம் , நன்றி ?', 'Taml'), 'tam_Taml', new Map());
  assert.equal(back, 'வணக்கம், நன்றி?');
});

test('numbers in the source survive the round trip', () => {
  const { text, entities } = preprocess('Meet at 10:30 on 12/05/2024.', 'eng_Latn');
  assert.ok(!text.includes('10:30'));
  assert.equal(postprocess(text, 'eng_Latn', entities), 'Meet at 10:30 on 12/05/2024.');
});

/* ---------------- planning / languages ---------------- */

test('there are 22 Indian languages, each with a unique IndicTrans2 tag', () => {
  assert.equal(INDIAN_LANGUAGES.length, 22);
  assert.equal(new Set(INDIAN_LANGUAGES.map((l) => l.flores)).size, 22);
});

test('planOffline: direct, pivot, or unavailable', () => {
  const has = (...b) => new Set(b);
  assert.deepEqual(planOffline('en', 'hi', has('en-indic')).map((s) => s.bundle), ['en-indic']);
  assert.equal(planOffline('en', 'hi', has('indic-en')), null);
  assert.deepEqual(planOffline('ta', 'en', has('indic-en')).map((s) => s.bundle), ['indic-en']);
  assert.deepEqual(planOffline('ta', 'hi', has('indic-indic')).map((s) => s.bundle), ['indic-indic']);
  const pivot = planOffline('ta', 'hi', has('indic-en', 'en-indic'));
  assert.deepEqual(pivot.map((s) => [s.src, s.tgt]), [['tam_Taml', 'eng_Latn'], ['eng_Latn', 'hin_Deva']]);
  assert.equal(planOffline('fr', 'hi', has('indic-en', 'en-indic')), null, 'French pivots need the French packs too');
  assert.deepEqual(bundlesNeeded('hi', 'en'), ['indic-en']);
});

test('planOffline: world languages are one pack per direction and pivot through English', () => {
  const has = (...b) => new Set(b);
  assert.deepEqual(planOffline('en', 'fr', has('mt-en-fr')), [{ bundle: 'mt-en-fr', src: 'en', tgt: 'fr' }]);
  assert.deepEqual(planOffline('fr', 'en', has('mt-fr-en')), [{ bundle: 'mt-fr-en', src: 'fr', tgt: 'en' }]);
  assert.equal(planOffline('en', 'fr', has('mt-fr-en')), null, 'the other direction does not help');
  assert.equal(planOffline('fr', 'en', has('mt-en-fr')), null);
  assert.deepEqual(planOffline('fr', 'de', has('mt-fr-en', 'mt-en-de')).map((s) => s.bundle), ['mt-fr-en', 'mt-en-de']);
  assert.equal(planOffline('fr', 'de', has('mt-fr-en')), null);
  // world <-> Indian goes through English as well, using one pack of each family
  assert.deepEqual(planOffline('fr', 'hi', has('mt-fr-en', 'en-indic')).map((s) => s.bundle), ['mt-fr-en', 'en-indic']);
  assert.deepEqual(planOffline('hi', 'es', has('indic-en', 'mt-en-es')).map((s) => s.bundle), ['indic-en', 'mt-en-es']);
  assert.equal(planOffline('fr', 'hi', has('mt-fr-en')), null);
  assert.equal(planOffline('ro', 'en', has('mt-ro-en')), null, 'languages without a pack stay online-only');
  assert.deepEqual(bundlesNeeded('fr', 'de'), ['mt-fr-en', 'mt-en-de']);
  assert.deepEqual(bundlesNeeded('en', 'ru'), ['mt-en-ru']);
  assert.deepEqual(bundlesNeeded('es', 'ta'), ['mt-es-en', 'en-indic']);
});

test('world packs: every language has both directions, come from Hugging Face only and have exact file sizes', () => {
  for (const code of OFFLINE_WORLD_CODES) {
    for (const id of [`mt-en-${code}`, `mt-${code}-en`]) {
      const b = PACKS[id];
      assert.ok(b, `${id} exists`);
      assert.equal(b.hfOnly, true);
      assert.equal(b.kind, 'marian');
      assert.match(b.sha, /^[0-9a-f]{40}$/, `${id} is pinned to a commit`);
      for (const f of b.files) assert.ok(Number.isInteger(f.size) && f.size > 0, `${id}/${f.name} has a size`);
      const names = b.files.map((f) => f.name);
      for (const need of ['encoder_model_int8.onnx', 'decoder_model_merged_int8.onnx', 'tokenizer.json', 'tokenizer_config.json', 'config.json']) {
        assert.ok(names.includes(need), `${id} has ${need}`);
      }
      // never offered from /models on our server, on any device
      for (const mode of ['hf-first', 'server', 'server-first']) {
        const urls = sourceOrder(b, 'config.json', mode);
        assert.equal(urls.length, 1);
        assert.ok(urls[0].startsWith(`https://huggingface.co/${b.repo}/resolve/${b.sha}/`), urls[0]);
        assert.ok(!urls.some((u) => u.startsWith('/models')), 'not served from our server');
      }
    }
  }
  // the ONNX files live under onnx/ in the repository but are cached under their plain name
  const fr = PACKS['mt-en-fr'];
  assert.equal(sourceOrder(fr, 'encoder_model_int8.onnx', 'hf-first')[0], `https://huggingface.co/${fr.repo}/resolve/${fr.sha}/onnx/encoder_model_int8.onnx`);
  // Indian packs keep their server mirror
  assert.ok(sourceOrder(PACKS['en-indic'], 'tokenizer_meta.json', 'hf-first').includes('/models/en-indic/tokenizer_meta.json'));
});

test('detectLanguage works offline from the script', () => {
  assert.equal(detectLanguage('नमस्ते दोस्त'), 'hi');
  assert.equal(detectLanguage('வணக்கம்'), 'ta');
  assert.equal(detectLanguage('Where is the station?'), 'en');
  assert.equal(detectLanguage('1234'), null);
});

test('client chunker is paragraph-safe', () => {
  const segs = segmentText('Hello.\n\nWorld.');
  assert.equal(assemble(segs, segs.filter((s) => 'chunk' in s).map((s) => s.chunk.toUpperCase())), 'HELLO.\n\nWORLD.');
});

import { groupIndian, formatIndian, inLakhCrore, amountHints } from '../src/lib/indianFormat.js';
import { PHRASE_CATEGORIES } from '../src/lib/phrases.js';

test('groupIndian uses lakh/crore grouping', () => {
  assert.equal(groupIndian('999'), '999');
  assert.equal(groupIndian('1000'), '1,000');
  assert.equal(groupIndian('100000'), '1,00,000');
  assert.equal(groupIndian('1234567'), '12,34,567');
  assert.equal(groupIndian('100000000'), '10,00,00,000');
});

test('formatIndian regroups western commas and rupee amounts', () => {
  assert.equal(formatIndian('It costs 1,000,000 in total', 'en'), 'It costs 10,00,000 in total');
  assert.equal(formatIndian('Pay Rs. 1500000 now', 'en'), 'Pay ₹15,00,000 now');
  assert.equal(formatIndian('Pay INR 2,500.50', 'en'), 'Pay ₹2,500.50');
  assert.equal(formatIndian('₹1,234,567', 'hi'), '₹12,34,567');
  assert.equal(formatIndian('Rs 500', 'en'), '₹500');
});

test('formatIndian never touches phone numbers, PINs, Aadhaar or years', () => {
  for (const s of ['Call 9876543210', 'PIN 110001', 'Aadhaar 1234 5678 9012', 'In 2024 it rained', 'Room 12345']) {
    assert.equal(formatIndian(s, 'en'), s);
  }
});

test('formatIndian converts unambiguous dates to DD/MM/YYYY', () => {
  assert.equal(formatIndian('Due 2024-03-25', 'en'), 'Due 25/03/2024');
  assert.equal(formatIndian('Due 03/25/2024', 'en'), 'Due 25/03/2024');
  assert.equal(formatIndian('Due 03/04/2024', 'en'), 'Due 03/04/2024'); // ambiguous: left alone
  assert.equal(formatIndian('On March 25, 2024 we met', 'en'), 'On 25/03/2024 we met');
  assert.equal(formatIndian('On 5th of April 2023', 'en'), 'On 05/04/2023');
  assert.equal(formatIndian('Version 2024-13-45', 'en'), 'Version 2024-13-45');
});

test('inLakhCrore / amountHints', () => {
  assert.equal(inLakhCrore(50000), null);
  assert.equal(inLakhCrore(1000000), '10 lakh');
  assert.equal(inLakhCrore(25000000), '2.5 crore');
  assert.deepEqual(amountHints('Price ₹15,00,000 only'), [{ raw: '₹15,00,000', words: '15 lakh' }]);
  assert.deepEqual(amountHints('Call 9876543210 or PIN 110001'), []);
});

test('phrasebook: unique ids, 10 unique phrases each, India categories present', () => {
  const ids = PHRASE_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['govt', 'bank', 'ids', 'hospital', 'police', 'railway', 'pilgrimage', 'farm']) assert.ok(ids.includes(id), id);
  for (const c of PHRASE_CATEGORIES) {
    assert.equal(c.phrases.length, 10, c.id);
    assert.equal(new Set(c.phrases).size, 10, c.id);
  }
  const all = PHRASE_CATEGORIES.flatMap((c) => c.phrases);
  assert.equal(new Set(all).size, all.length, 'no phrase repeated across categories');
});

import { REGIONS, regionForCountry, countryFromLocale, downloadPolicy, bundleBytes } from '../src/lib/region.js';

test('region: India maps to the two small bundles, other countries to nothing', () => {
  assert.deepEqual(regionForCountry('IN').bundles, ['en-indic', 'indic-en']);
  assert.equal(regionForCountry('in').id, 'in');
  assert.equal(regionForCountry('FR'), null);
  assert.equal(regionForCountry(null), null);
  assert.ok(!REGIONS.IN.bundles.includes('indic-indic'), 'the optional 358 MB direct model is not part of the default download');
});

test('region: first download stays around 545 MB and every Indian pair stays reachable', () => {
  const mb = bundleBytes(REGIONS.IN.bundles) / 1e6;
  assert.ok(mb > 500 && mb < 600, `size was ${mb} MB`);
  const installed = new Set(REGIONS.IN.bundles);
  for (const l of INDIAN_LANGUAGES) {
    assert.ok(planOffline('en', l.code, installed), `en -> ${l.code}`);
    assert.ok(planOffline(l.code, 'en', installed), `${l.code} -> en`);
    assert.ok(planOffline(l.code, 'hi' === l.code ? 'ta' : 'hi', installed), `${l.code} <-> Indian pivots through English`);
  }
});

test('region: locale guess prefers the timezone, then the language region', () => {
  assert.equal(countryFromLocale({ timeZone: 'Asia/Kolkata', languages: ['en-US'] }), 'IN');
  assert.equal(countryFromLocale({ timeZone: 'Europe/Paris', languages: ['en-IN'] }), null, 'en-IN abroad is not India');
  assert.equal(countryFromLocale({ languages: ['hi-IN'] }), 'IN');
  assert.equal(countryFromLocale({ languages: ['hi'] }), null);
  assert.equal(countryFromLocale({}), null);
});

test('region: download policy', () => {
  const need = 545e6;
  assert.equal(downloadPolicy({ needBytes: need, freeBytes: 5e9 }).auto, true, 'desktop, plenty of space');
  assert.equal(downloadPolicy({ needBytes: need, freeBytes: null }).auto, true, 'unknown free space does not block');
  assert.equal(downloadPolicy({ needBytes: need, freeBytes: 800e6 }).blocked, true, 'below the 1 GB minimum');
  assert.equal(downloadPolicy({ needBytes: need, freeBytes: 1.2e9 }).blocked, false, 'between 1 and 1.5 GB: warn, do not block');
  assert.equal(downloadPolicy({ needBytes: need, freeBytes: 1.2e9 }).auto, false);
  assert.equal(downloadPolicy({ needBytes: need, saveData: true }).auto, false);
  assert.equal(downloadPolicy({ needBytes: need, type: 'cellular' }).auto, false);
  assert.equal(downloadPolicy({ needBytes: need, effectiveType: '3g' }).auto, false);
  assert.equal(downloadPolicy({ needBytes: need, effectiveType: '4g' }).auto, true);
  assert.equal(downloadPolicy({ needBytes: need, coarsePointer: true }).auto, false, 'phone with unknown network asks first');
  assert.equal(downloadPolicy({ needBytes: need, coarsePointer: true, type: 'wifi' }).auto, true, 'phone on Wi-Fi goes ahead');
});

import { pickLocalVoice } from '../src/hooks/useSpeech.js';

test('pickLocalVoice only returns on-device voices, preferring an exact locale', () => {
  const v = (lang, localService) => ({ lang, localService, name: lang + localService });
  const voices = [v('hi-IN', false), v('en-US', true), v('en-GB', true), v('ta_IN', true)];
  assert.equal(pickLocalVoice(voices, 'hi-IN'), null, 'cloud-only voice must not be used');
  assert.equal(pickLocalVoice(voices, 'en-GB').lang, 'en-GB');
  assert.equal(pickLocalVoice(voices, 'en-IN').lang, 'en-US', 'falls back to the same language');
  assert.equal(pickLocalVoice(voices, 'ta-IN').lang, 'ta_IN');
  assert.equal(pickLocalVoice([], 'en-US'), null);
});

/* ---------- private mode storage ---------- */
function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
async function freshStorage() {
  globalThis.localStorage = fakeStorage();
  globalThis.sessionStorage = fakeStorage();
  globalThis.navigator ??= { language: 'en-US' };
  return import(`../src/lib/storage.js?${Math.random()}`);
}

test('private mode writes only to sessionStorage, never localStorage', async () => {
  const s = await freshStorage();
  s.setPrivateSession(true);
  assert.equal(s.isPrivateSession(), true);
  s.saveSettings({ ...s.loadSettings(), source: 'ta', privateMode: true });
  s.saveHistory([{ id: 1, text: 'secret', result: 'x' }], true);
  s.savePhrasebook({ saved: [{ id: 1, text: 'secret', result: 'x', target: 'hi' }], cache: { 'hi|Hello': 'नमस्ते' } }, true);
  assert.equal(localStorage._m.size, 0, 'nothing may reach localStorage');
  assert.ok(sessionStorage._m.size >= 3);
  assert.ok(![...localStorage._m.values()].join('').includes('secret'));
});

test('normal data is untouched by a private session and returns afterwards', async () => {
  const s = await freshStorage();
  s.saveHistory([{ id: 1, text: 'normal entry' }], false);
  s.savePhrasebook({ saved: [{ id: 2, text: 'kept' }], cache: { 'hi|Hello': 'नमस्ते' } }, false);

  s.setPrivateSession(true);
  assert.deepEqual(s.loadHistory(true), [], 'private history starts empty');
  assert.deepEqual(s.loadPhrasebook(true).saved, [], 'private saved phrases start empty');
  assert.equal(s.loadPhrasebook(true).cache['hi|Hello'], 'नमस्ते', 'already-translated phrases still work');
  s.saveHistory([{ id: 9, text: 'private entry' }], true);
  s.savePhrasebook({ saved: [{ id: 9, text: 'p' }], cache: { 'hi|Hello': 'नमस्ते', 'hi|Thanks': 'धन्यवाद' } }, true);
  assert.equal(JSON.parse(sessionStorage.getItem('anuvadsetu.phrasebook.v1')).cache['hi|Hello'], undefined, 'only new entries go to the session');

  s.setPrivateSession(false); // leaving private mode wipes the session
  assert.equal(sessionStorage._m.size, 0);
  assert.equal(s.isPrivateSession(), false);
  assert.equal(s.loadHistory(false)[0].text, 'normal entry');
  assert.equal(s.loadPhrasebook(false).saved[0].text, 'kept');
  assert.equal(s.loadPhrasebook(false).cache['hi|Thanks'], undefined, 'private translations did not leak into normal data');
});

test('the private flag comes from the session, not from stored settings', async () => {
  const s = await freshStorage();
  localStorage.setItem('anuvadsetu.settings.v1', JSON.stringify({ privateMode: true, target: 'ta' }));
  assert.equal(s.loadSettings().privateMode, false, 'a stale stored flag must not switch private mode on');
  s.setPrivateSession(true);
  assert.equal(s.loadSettings().privateMode, true);
  assert.equal(s.loadSettings().target, 'ta', 'normal preferences are still applied');
  s.saveSettings({ ...s.loadSettings(), theme: 'dark', privateMode: true });
  assert.equal(JSON.parse(localStorage.getItem('anuvadsetu.settings.v1')).theme, undefined, 'private settings never touch localStorage');
});

import { storageLevel } from '../src/lib/region.js';

test('storageLevel: 570 MB download -> 1.5 GB comfortable, 1.0 GB minimum', () => {
  const need = 570e6;
  assert.equal(storageLevel(2e9, need).level, 'ok');
  assert.equal(storageLevel(1.5e9, need).level, 'ok', 'exactly 1.5 GB is fine');
  assert.equal(storageLevel(1.49e9, need).level, 'low');
  assert.equal(storageLevel(1.0e9, need).level, 'low', 'exactly 1.0 GB is still only a warning');
  assert.equal(storageLevel(0.99e9, need).level, 'critical');
  assert.equal(storageLevel(0.2e9, need).level, 'critical');
  assert.equal(storageLevel(null, need).level, 'unknown');
  assert.equal(storageLevel(undefined, need).level, 'unknown');
  assert.match(storageLevel(0.5e9, need).message, /Offline translation will not work/);
  assert.match(storageLevel(1.2e9, need).message, /1\.5 GB is recommended/);
});

test('storageLevel: thresholds scale down for a single smaller pack', () => {
  const one = 295e6; // one pack
  assert.equal(storageLevel(0.9e9, one).level, 'ok', 'a single pack does not need the full 1.5 GB');
  assert.equal(storageLevel(0.7e9, one).level, 'low');
  assert.equal(storageLevel(0.4e9, one).level, 'critical');
});

test('downloadPolicy: low storage never auto-downloads, critical blocks, unknown does not block', () => {
  const need = 570e6;
  const ok = downloadPolicy({ needBytes: need, freeBytes: 3e9 });
  assert.deepEqual([ok.auto, ok.blocked, ok.level], [true, false, 'ok']);
  const low = downloadPolicy({ needBytes: need, freeBytes: 1.2e9 });
  assert.deepEqual([low.auto, low.blocked, low.level], [false, false, 'low']);
  assert.match(low.reason, /Storage is low/);
  const crit = downloadPolicy({ needBytes: need, freeBytes: 0.8e9 });
  assert.deepEqual([crit.auto, crit.blocked, crit.level], [false, true, 'critical']);
  assert.match(crit.reason, /will not work/);
  const unk = downloadPolicy({ needBytes: need, freeBytes: null });
  assert.deepEqual([unk.auto, unk.blocked, unk.level], [true, false, 'unknown']);
});

import { sourceOrder, BUNDLES as PACKS } from '../src/offline/store.js';

test('sourceOrder: computers use Hugging Face first, phones use our server only', () => {
  const b = PACKS['en-indic'];
  const isHf = (u) => u.startsWith('https://huggingface.co/');
  const hf = sourceOrder(b, 'tokenizer_meta.json', 'hf-first');
  assert.equal(hf.length, 2);
  assert.ok(isHf(hf[0]) && hf[1] === '/models/en-indic/tokenizer_meta.json');
  assert.deepEqual(sourceOrder(b, 'tokenizer_meta.json', 'server'), ['/models/en-indic/tokenizer_meta.json']);
  const sf = sourceOrder(b, 'tokenizer_meta.json', 'server-first');
  assert.ok(sf[0] === '/models/en-indic/tokenizer_meta.json' && isHf(sf[1]));
  assert.ok(hf[0].includes(b.sha), 'pinned revision');
});
