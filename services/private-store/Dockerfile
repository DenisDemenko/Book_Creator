# Локальний сервер приватного сховища Nova Studio (журнал #549, розпізнавання знімків — #550).
# Залежності з npm (чотири, версії зафіксовано в package-lock.json): tesseract.js і мовні моделі (розпізнавання без мережі й
# без ШІ-провайдера), @napi-rs/canvas (підготовка знімка). Усе інше — лише вбудовані модулі Node (http, crypto, sqlite, fetch).
# Збірка з теки services/private-store:  docker build -t nova-private-store:0.2.0 .

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: жоден пакет не виконує код під час встановлення; мовні моделі беруться з пакетів, а не з мережі.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="nova-private-store" \
      org.opencontainers.image.description="Local private storage server for Nova Studio books, courses and instructions, with local OCR" \
      org.opencontainers.image.source="https://github.com/DenisDemenko/Book_Creator"

ENV NODE_ENV=production \
    PRIVATE_STORE_DATA_DIR=/data \
    PRIVATE_STORE_HOST=0.0.0.0 \
    PRIVATE_STORE_PORT=8787 \
    PRIVATE_STORE_TESSDATA_DIR=/app/tessdata \
    PRIVATE_STORE_TESSDATA_GZIP=true

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Мовні моделі Tesseract (українська й англійська) лежать в образі: під час роботи нічого не завантажується.
RUN mkdir -p /app/tessdata \
 && cp node_modules/@tesseract.js-data/ukr/4.0.0_best_int/ukr.traineddata.gz /app/tessdata/ \
 && cp node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz /app/tessdata/

# Дані (зашифрована база) — окремий том. Код лише для читання, власник — root; сервер працює без прав адміністратора.
RUN mkdir -p /data && chown 10001:10001 /data && chmod 700 /data
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8787

# Перевірка здоров'я: порт слухає й сервер відповідає (Host має бути в переліку дозволених — для 127.0.0.1 він завжди там).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "const p=process.env.PRIVATE_STORE_PORT||8787;fetch('http://127.0.0.1:'+p+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.mjs"]
