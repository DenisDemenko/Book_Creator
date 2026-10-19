# Nova (NOVA STUDIO) для Railway.
# Node 22 потрібен для вбудованого node:sqlite.

# ---------------------------------------------------------------------------
# DesignCraft: окремий pinned stage. Беремо офіційний Linux tarball v0.7.1
# і перевіряємо SHA256 із release, щоб production не залежав від "latest".
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS designcraft
ARG DESIGNCRAFT_VERSION=0.7.1
ARG DESIGNCRAFT_SHA256=05a2b2531f6f26746b4a743081fd00f9ea77822fa178663802a0eaeced6c1437
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -fsSL \
      -o /tmp/designcraft.tar.gz \
      "https://github.com/storytold/designcraft/releases/download/v${DESIGNCRAFT_VERSION}/designcraft-${DESIGNCRAFT_VERSION}-linux-x86_64.tar.gz" \
    && echo "${DESIGNCRAFT_SHA256}  /tmp/designcraft.tar.gz" | sha256sum -c - \
    && mkdir -p /opt/designcraft \
    && tar -xzf /tmp/designcraft.tar.gz --strip-components=1 -C /opt/designcraft \
    && /opt/designcraft/bin/designcraft-cli --version \
    && rm -rf /var/lib/apt/lists/* /tmp/designcraft.tar.gz

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG NOVA_BASE_PATH=/studio/
ENV NOVA_BASE_PATH=$NOVA_BASE_PATH

ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_NOVA_WS_URL
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_NOVA_WS_URL=$VITE_NOVA_WS_URL

RUN npm run build
# One-shot Gate B verifier is still bundled for explicit diagnostics, but it is
# not part of web-server startup: a long book render must never delay or block
# the public Studio service.
RUN npx esbuild scripts/gate-b-publish-arhat.mts \
      --bundle --platform=node --format=esm --packages=external \
      --outfile=dist/gate-b-publish-arhat.mjs

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# Vite embeds NOVA_BASE_PATH into browser asset/API URLs at build time.
# The Express prefix-strip middleware also needs the SAME value at runtime:
# without it, /studio/assets/*.js and *.css return 404 on the direct Railway host.
# Re-declare ARG in this Docker stage so build-arg overrides stay synchronized.
ARG NOVA_BASE_PATH=/studio/
ENV NODE_ENV=production \
    NOVA_BASE_PATH=${NOVA_BASE_PATH}

# Системні PDF-рушії. Debian потрібен для Chromium/TeX і сумісний з
# офіційним DesignCraft build (glibc).
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ffmpeg \
      pandoc \
      texlive-xetex \
      texlive-latex-extra \
      texlive-fonts-recommended \
      texlive-fonts-extra \
      texlive-lang-cyrillic \
      lmodern \
      fonts-dejavu \
      fontconfig \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# Headless DesignCraft binary + вузький compatibility shim для стабільного
# release v0.7.1. GUI в серверний образ не потрапляє.
COPY --from=designcraft /opt/designcraft/bin/designcraft-cli /usr/local/lib/designcraft/designcraft-cli
COPY --from=build /app/scripts/designcraft-cli-compat.sh /usr/local/bin/designcraft-cli-compat
RUN chmod +x /usr/local/bin/designcraft-cli-compat /usr/local/lib/designcraft/designcraft-cli
ENV DESIGNCRAFT_REAL_PATH=/usr/local/lib/designcraft/designcraft-cli \
    DESIGNCRAFT_PATH=/usr/local/bin/designcraft-cli-compat \
    CHROMIUM_PATH=/usr/bin/chromium

# NODE_ENV=production вмикає роздачу готового dist/.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/package.json package.json

# Ресурси, які сервер шукає в рантаймі.
COPY --from=build /app/server/pdf/fonts dist/fonts
COPY --from=build /app/server/pdf/latex dist/latex
COPY --from=build /app/server/core/migrations dist/core-migrations

# Постійні дані Railway volume /data.
ENV DATA_DIR=/data \
    GENERATED_IMAGES_DIR=/data/generated

EXPOSE 3000
CMD ["node", "dist/server.mjs"]
