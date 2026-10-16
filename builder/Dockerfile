# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine
ENV CONTENT_DIR=/content \
    DATA_DIR=/data \
    SITE_DIR=/site \
    ASTRO_TELEMETRY_DISABLED=1
WORKDIR /app
RUN mkdir -p /data /site && chown node:node /data /site /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=3 \
  CMD test -e /site/current/index.html || exit 1
CMD ["sh", "scripts/run.sh"]
