# syntax=docker/dockerfile:1.7
# Linky web + CLI en un contenedor. Node 24 (LTS) sobre Debian slim, usuario sin privilegios.
# Tres etapas: build (compila la interfaz y audita), deps (solo dependencias de producción), final (solo lo que corre).

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------- compilación de la interfaz + auditoría ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY web/package.json web/package-lock.json web/
RUN npm ci --ignore-scripts --prefix web
COPY . .
RUN npm --prefix web run build \
 && npm audit --audit-level=low \
 && npm --prefix web audit --audit-level=low

# ---------- solo dependencias de producción ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY web/package.json web/package-lock.json web/
RUN npm ci --omit=dev --ignore-scripts --prefix web \
 && npm cache clean --force

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
 && rm -rf /usr/local/lib/node_modules/npm/docs /usr/local/lib/node_modules/npm/man \
 && mkdir -p /data/web /data/linky \
 && chown -R node:node /data
WORKDIR /app
# Dependencias de producción y, del código, solo lo que se ejecuta (sin pruebas, fuentes de la interfaz ni docs).
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=deps --chown=root:root /app/web/node_modules ./web/node_modules
COPY --from=build --chown=root:root /app/package.json /app/AGENTS.md ./
COPY --from=build --chown=root:root /app/agent ./agent
COPY --from=build --chown=root:root /app/skills ./skills
COPY --from=build --chown=root:root /app/web/package.json /app/web/tsconfig.json ./web/
COPY --from=build --chown=root:root /app/web/server ./web/server
COPY --from=build --chown=root:root /app/web/shared ./web/shared
COPY --from=build --chown=root:root /app/web/dist ./web/dist
USER node
VOLUME ["/data"]
EXPOSE 4780
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4780/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--"]
# Directo con tsx (sin npm en medio): las señales llegan al servidor y se cierran todos los procesos hijos.
CMD ["node", "/app/web/node_modules/tsx/dist/cli.mjs", "/app/web/server/index.ts"]
