# Anuvad Setu: one image, one process. Express serves the built PWA, /api and /models.
#
#   docker build -t anuvad-setu .
#   docker run -p 3001:3001 --env-file .env -v anuvad-models:/app/server/models anuvad-setu
#
# The ~900 MB of translation models are NOT baked into the image (keeps it small and fast to deploy).
# They are downloaded once, in the background, into the mounted volume at first start.

# ---- 1. build the client ----
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- 2. runtime ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=3001 MODELS_DIR=/app/server/models
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
RUN mkdir -p /app/server/models && chown -R node:node /app
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
# Start serving immediately and fetch any missing models in the background (files already in the volume are
# skipped). Until a file arrives the browser falls back to Hugging Face for it.
CMD ["sh", "-c", "node scripts/fetch-models.mjs & exec node src/index.js"]
