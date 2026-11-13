import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const API_TARGET = process.env.API_TARGET || 'http://localhost:3001';

// onnxruntime-web import()s /ort/*.mjs at runtime. In dev, Vite refuses to "transform" a file that lives in
// /public, so serve those files untouched before Vite's own middleware sees them. (Build output is unaffected.)
const serveOrtRaw = () => ({
  name: 'serve-ort-raw',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url || '').split('?')[0];
      if (!path.startsWith('/ort/') || path.includes('..')) return next();
      const file = resolve(server.config.publicDir, path.slice(1));
      if (!existsSync(file)) return next();
      res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      createReadStream(file).pipe(res);
    });
  },
});

export default defineConfig({
  plugins: [
    serveOrtRaw(),
    react(),
    VitePWA({
      registerType: 'prompt', // we show an "Update available" toast instead of silently swapping versions
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        id: '/',
        name: 'Anuvad Setu - अनुवाद सेतु',
        short_name: 'Anuvad Setu',
        description: 'Private, offline-first translator for all 22 Indian languages and English.',
        theme_color: '#2563eb',
        background_color: '#0b1220',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'utilities', 'education'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [{ name: 'New translation', url: '/?focus=1', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] }],
      },
      workbox: {
        // App shell (html/js/css/icons) is precached. The big ONNX wasm is cached on first use instead.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        globIgnores: ['ort/**'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ort\//, /^\/models\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/ort/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ort-runtime',
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  server: {
    port: 5173,
    proxy: { '/api': API_TARGET, '/models': API_TARGET },
  },
  preview: { port: 4173, proxy: { '/api': API_TARGET, '/models': API_TARGET } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
