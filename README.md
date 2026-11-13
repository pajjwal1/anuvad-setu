# Anuvad Setu (अनुवाद सेतु)

Private, offline-first translator PWA for the 22 scheduled Indian languages and English.
React 19 + Vite frontend, Node/Express backend. Works on desktop, tablet and mobile browsers.

## How it is put together

One Node process serves everything, so you deploy **one thing**:

| Path | Served by |
|---|---|
| `/` and the app files | the built frontend (`client/dist`) |
| `/api/*` | translation API (Sarvam / LibreTranslate / Google / MyMemory, in that order) |
| `/models/*` | mirror of the on-device model files (~900 MB, Range requests supported) |

The frontend and backend share one origin, so there is no CORS setup and the service worker works.

## Run locally

```bash
npm run install:all
npm run build                 # builds client/dist
npm --prefix server run models   # downloads the models into server/models (~900 MB, resumable)
npm start                     # http://localhost:3001
```

For development: `npm run dev:server` and `npm run dev:client` (Vite on :5173 proxies `/api` and `/models`).

Copy `.env.example` to `.env` and set `SARVAM_API_KEY` for good online quality on Indian languages.
Without any key the server falls back to MyMemory, which is much weaker for them.

## Deploy

### Requirements for any host
- **HTTPS.** Browsers only allow service workers (and so install + offline) on HTTPS (localhost is exempt).
- **Persistent disk** for `server/models` (~900 MB), or let clients fetch from Hugging Face (see below).
- **Node 20+**, or Docker.

### Option A: Docker (recommended)
```bash
docker build -t anuvad-setu .
docker run -d -p 3001:3001 --env-file .env -v anuvad-models:/app/server/models anuvad-setu
```
The image holds the app only. On first start the server begins serving immediately and downloads the models
into the volume in the background.

### Option B: a VPS without Docker
```bash
git clone <repo> && cd lingua
npm run install:all && npm run build
npm --prefix server run models
PORT=3001 node server/src/index.js      # keep alive with pm2 or systemd
```
Put nginx or Caddy in front for HTTPS (Caddy: `your.domain { reverse_proxy localhost:3001 }`).
Do not let the proxy buffer or cache `/models/*` responses in memory; pass them straight through.

### Option C: split hosting (not needed, listed for completeness)
Static frontend on a CDN plus the API elsewhere works only if you route `/api` and `/models` to the backend on
the **same domain** (a CDN path rule). Otherwise you must add CORS and change the client's fetch URLs.

### How the packs reach a device
The server keeps the model files in `server/models` and serves them at `/models`. A pack that is not on disk yet is
fetched from Hugging Face by the server, once, when the first phone or tablet asks for it
(`POST /api/models/:id/prepare`, progress at `GET /api/models/:id`). After that everyone downloads it from your server.
- **Phones and tablets** (touch as the main input) download from your server only, never directly from Hugging Face.
  The app shows "Preparing the language pack on our server" while the server fetches it the first time.
- **Computers** download from Hugging Face directly and use your server only as a backup, so they put no load on it.
- Only the known pack names are accepted, files are size-checked and written under a temporary name first, so a
  half-downloaded file is never served. A new country needs its pack added in `server/src/models.js` and
  `client/src/offline/store.js` (a test checks they match).

### Without hosting the models
If `/models` returns 404, computers download the same pinned files from Hugging Face instead. This works but
makes first-time pack installs depend on a third party, so mirroring them is recommended.

## Tests
```bash
npm --prefix server test     # 31 tests
npm --prefix client test     # 34 tests
```

## Status and known limits
- Unit tests and the production build pass. **Browser testing of the offline engine, PWA install and layouts has
  not been done yet.**
- On-device models are 250-360 MB per bundle and run single-threaded WebAssembly; speed and memory on low-end
  phones are unmeasured.
- Online quality for Indian languages needs a Sarvam API key (not yet tried live).
- Assamese, Meitei and Santali output shows artifacts. Urdu, Kashmiri and Sindhi are not romanized.
- Camera OCR is planned for after launch.

## Region detection
On first visit the app decides whether to offer the India language packs. The server answers `GET /api/region` from,
in order: a CDN / proxy country header (`CF-IPCountry`, `CloudFront-Viewer-Country`, ...), then the request IP looked
up in a local country database (`geoip-country`). The lookup runs inside the server process: the IP is not sent to any
third party and is not stored. If both are unknown (local or private addresses) the browser falls back to its timezone
and language.
Behind a reverse proxy the real client IP is read from `X-Forwarded-For` (`trust proxy` is set to 1 hop), so make sure
your proxy sets it. The database ships inside the npm package; update it with `npm update geoip-country`.

## Licences
IndicTrans2 distilled ONNX int8 models (MIT) by AI4Bharat, converted by `hari31416`.
IP-to-country data: `geoip-country`, which bundles MaxMind GeoLite2 data (CC BY-SA 4.0 / GeoLite2 EULA). This product
includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.
