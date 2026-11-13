import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { segmentText, assemble } from './chunk.js';
import { countryFromRequest } from './region.js';
import { LruCache } from './cache.js';
import { rateLimit } from './rateLimit.js';
import { buildProviders } from './providers.js';
import { detectIndicScript } from './indic.js';
import { createModelStore } from './models.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_CHARS = 5000;
const LANG_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/;

export function createApp({ providers = buildProviders(), cache = new LruCache(), models } = {}) {
  const modelsDir = process.env.MODELS_DIR
    ? path.resolve(process.env.MODELS_DIR)
    : path.resolve(__dirname, '../models');
  models ??= createModelStore({ dir: modelsDir });
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50kb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, providers: providers.map((p) => p.name) }));

  // Country of the visitor: CDN / proxy header if present, else a local IP-to-country lookup (nothing leaves
  // this server). `null` means "unknown" and the client falls back to timezone + language.
  app.get('/api/region', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ country: countryFromRequest(req) });
  });

  async function translateChunk(provider, chunk, source, target) {
    const key = `${provider.name}|${source}|${target}|${chunk}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const result = await provider.translate(chunk, source, target);
    cache.set(key, result);
    return result;
  }

  /** Translate the whole text with one provider (chunked to that provider's limits). */
  async function translateWith(provider, text, source, target) {
    const segments = segmentText(text, provider.maxChars ?? 450, provider.size);
    const chunks = segments.filter((s) => 'chunk' in s).map((s) => s.chunk);
    const results = [];
    for (const chunk of chunks) results.push(await translateChunk(provider, chunk, source, target));
    return {
      text: assemble(segments, results.map((r) => r.text)),
      detected: results[0]?.detected ?? null,
      provider: provider.name,
    };
  }

  /**
   * Try each provider that supports this pair, in priority order, until one succeeds.
   * The whole text goes to a single provider so a long text isn't a patchwork of engines.
   */
  async function translateRouted(text, source, target) {
    const candidates = providers.filter((p) => p.supports(source, target));
    let lastErr = new Error('No translation provider supports this language pair');
    for (const provider of candidates) {
      try {
        return await translateWith(provider, text, source, target);
      } catch (err) {
        lastErr = err;
        console.warn(`[${provider.name}] failed: ${err.message}`);
      }
    }
    throw lastErr;
  }

  /** Work out the real source language when the client asked for auto-detect. */
  async function resolveSource(text, target) {
    // Indian scripts identify the language reliably and let us use the India-specialised engine.
    const byScript = detectIndicScript(text);
    if (byScript) return { source: byScript, detected: byScript, firstPass: null };

    // Otherwise ask an engine that can detect; its answer lets us re-route to a better engine.
    const first = await translateRouted(text, 'auto', target);
    const code = first.detected ? first.detected.split('-')[0].toLowerCase() : null;
    return { source: code ?? 'auto', detected: code, firstPass: first };
  }

  app.post('/api/translate', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
    const { text, source = 'auto', target } = req.body ?? {};
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Text is required.' });
    }
    if (text.length > MAX_CHARS) {
      return res.status(413).json({ error: `Text is too long (max ${MAX_CHARS} characters).` });
    }
    if (typeof target !== 'string' || !LANG_RE.test(target)) {
      return res.status(400).json({ error: 'A valid target language is required.' });
    }
    if (source !== 'auto' && !LANG_RE.test(String(source))) {
      return res.status(400).json({ error: 'Invalid source language.' });
    }
    if (source === target) {
      return res.json({ text, source, target, detected: null, provider: 'none' });
    }

    try {
      let effectiveSource = source;
      let detected = null;
      let firstPass = null;
      if (source === 'auto') {
        ({ source: effectiveSource, detected, firstPass } = await resolveSource(text, target));
        if (effectiveSource === target) {
          return res.json({ text, source: effectiveSource, target, detected, provider: 'none' });
        }
      }

      let out;
      const best = providers.find((p) => p.supports(effectiveSource, target));
      if (firstPass && (effectiveSource === 'auto' || best?.name === firstPass.provider)) {
        out = firstPass; // the detection pass already used the best engine for this pair
      } else {
        try {
          out = await translateRouted(text, effectiveSource, target);
        } catch (err) {
          if (!firstPass) throw err;
          out = firstPass; // re-routing failed; keep the detection pass result
        }
      }
      res.json({
        text: out.text,
        source: effectiveSource,
        target,
        detected: source === 'auto' ? detected : null,
        provider: out.provider,
      });
    } catch (err) {
      console.error('Translate failed:', err.message);
      res.status(502).json({ error: 'Translation service is unavailable right now. Please try again.' });
    }
  });

  // Model packs: let phones / tablets ask this server to fetch a pack from Hugging Face once, so that they then
  // download it from here (/models) instead of from Hugging Face. Only the known pack ids are accepted.
  const modelsLimit = rateLimit({ windowMs: 60_000, max: 120 });
  app.get('/api/models/:id', modelsLimit, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const s = models.status(req.params.id);
    return s ? res.json(s) : res.status(404).json({ error: 'Unknown model pack' });
  });
  app.post('/api/models/:id/prepare', modelsLimit, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const s = models.prepare(req.params.id);
    return s ? res.json(s) : res.status(404).json({ error: 'Unknown model pack' });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // First-party mirror of the on-device model files (the client falls back to Hugging Face on 404).
  // express.static handles Range requests, which makes interrupted downloads resumable.
  app.use(
    '/models',
    express.static(modelsDir, {
      fallthrough: false,
      index: false,
      dotfiles: 'deny',
      immutable: true,
      maxAge: '365d',
      setHeaders(res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
      },
    }),
    (err, _req, res, _next) => res.status(err.status || 404).json({ error: 'Model file not found' }),
  );

  // Serve the built PWA (client/dist) when present.
  const dist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(
      express.static(dist, {
        setHeaders(res, file) {
          // The service worker & manifest must always be revalidated; hashed assets are immutable.
          if (/(sw\.js|registerSW\.js|manifest\.webmanifest|index\.html)$/.test(file)) {
            res.setHeader('Cache-Control', 'no-cache');
          } else if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3001;
  createApp().listen(port, () => console.log(`Anuvad Setu server listening on http://localhost:${port}`));
}
