# Локальний сервер приватного сховища Nova Studio (журнал #549).
# Жодних залежностей з npm: лише вбудовані модулі Node (http, crypto, sqlite, fetch) — менше чужого коду в образі.
# Збірка з теки services/private-store:  docker build -t nova-private-store:0.1.0 .
FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="nova-private-store" \
      org.opencontainers.image.description="Local private storage server for Nova Studio books, courses and instructions" \
      org.opencontainers.image.source="https://github.com/DenisDemenko/Book_Creator"

ENV NODE_ENV=production \
    PRIVATE_STORE_DATA_DIR=/data \
    PRIVATE_STORE_HOST=0.0.0.0 \
    PRIVATE_STORE_PORT=8787

WORKDIR /app
COPY package.json ./
COPY src ./src

# Дані (зашифрована база) — окремий том. Код лише для читання, власник — root; сервер працює без прав адміністратора.
RUN mkdir -p /data && chown 10001:10001 /data && chmod 700 /data
USER 10001:10001
VOLUME ["/data"]
EXPOSE 8787

# Перевірка здоров'я: порт слухає й сервер відповідає (Host має бути в переліку дозволених — для 127.0.0.1 він завжди там).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "const p=process.env.PRIVATE_STORE_PORT||8787;fetch('http://127.0.0.1:'+p+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.mjs"]
