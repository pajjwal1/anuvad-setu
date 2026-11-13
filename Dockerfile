# Anuvad Setu: one image, one process. Express serves the built PWA, /api and /models.
#
#   docker build -t anuvad-setu .
#   docker run -p 3001:3001 --env-file .env anuvad-setu
#
# The ~900 MB of translation models are downloaded from their pinned Hugging Face revisions at BUILD time and
# baked into the image (stage 2), so a host without a persistent disk (Hugging Face Spaces, Render free) still
# serves them after every restart. Nothing needs to be committed to git.
#
#   docker build --build-arg BAKE_MODELS=0 -t anuvad-setu .   small image; models are fetched on first start instead
#   (then add: -v anuvad-models:/app/server/models  to keep them across container re-creation)

# ---- 1. build the client ----
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- 2. download the models (own stage: cached unless the pack list or script changes) ----
FROM node:22-alpine AS models
ARG BAKE_MODELS=1
WORKDIR /app/server
COPY server/package.json ./
COPY server/scripts/fetch-models.mjs scripts/fetch-models.mjs
COPY server/src/models.js src/models.js
RUN mkdir -p /out && if [ "$BAKE_MODELS" = "1" ]; then MODELS_DIR=/out node scripts/fetch-models.mjs; fi

# ---- 3. runtime ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=3001 MODELS_DIR=/app/server/models
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
RUN mkdir -p /app/server/models && chown -R node:node /app
COPY --from=models --chown=node:node /out /app/server/models
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
# Start serving immediately and fetch any missing models in the background (files already present are skipped,
# so with baked models this is a no-op). Until a file arrives the browser falls back to Hugging Face for it.
CMD ["sh", "-c", "node scripts/fetch-models.mjs & exec node src/index.js"]
