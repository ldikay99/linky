# syntax=docker/dockerfile:1.7
# Linky web + CLI en un contenedor. Node 24 (LTS) sobre Debian slim, usuario sin privilegios.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------- dependencias y compilación de la interfaz ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/package.json web/package-lock.json web/
RUN npm ci --ignore-scripts --prefix web
COPY . .
RUN npm --prefix web run build \
 && npm audit --omit=dev --audit-level=low \
 && npm --prefix web audit --audit-level=low \
 && rm -rf web/client/public/pdfjs web/tests tests evals

# ---------- imagen final ----------
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    LINKY_WEB_HOST=0.0.0.0 \
    LINKY_WEB_PORT=4780 \
    LINKY_WEB_ALLOW_HTTP=1 \
    LINKY_WEB_OPEN_BROWSER=0 \
    LINKY_WEB_INTERACTIVE_LOGIN=0 \
    LINKY_WEB_SECRET_BACKEND=vault \
    LINKY_WEB_DATA_DIR=/data/web \
    LINKY_DATA_DIR=/data/linky \
    LINKY_TZ=America/Bogota \
    TZ=America/Bogota
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates git procps \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/web /data/linky \
 && chown -R node:node /data
WORKDIR /app
COPY --from=build --chown=root:root /app /app
USER node
VOLUME ["/data"]
EXPOSE 4780
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4780/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "--prefix", "web", "start"]
