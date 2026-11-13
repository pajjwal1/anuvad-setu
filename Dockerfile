# Anuvad Setu: one image, one process. Express serves the built PWA, /api and /models.
#
#   docker build -t anuvad-setu .
#   docker run -p 3001:3001 --env-file .env anuvad-setu
#
# The translation models are committed to the repo under server/models (Git LFS) and copied into the image,
# so /models/* is served from this server's own disk. The build host must have real LFS files checked out
# (not ~130-byte pointer files): run `git lfs pull` before building if unsure.

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
# --chown on the COPY (instead of a later `chown -R`) avoids duplicating the ~900 MB models in another layer.
COPY --chown=node:node server/ ./
COPY --from=client --chown=node:node /app/client/dist /app/client/dist
RUN mkdir -p /app/server/models && chown node:node /app/server/models
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
# Start serving immediately and fetch any missing models in the background (files with the right size are
# skipped, so with the committed models this is a no-op; a missing pack such as indic-indic is downloaded).
CMD ["sh", "-c", "node scripts/fetch-models.mjs & exec node src/index.js"]
