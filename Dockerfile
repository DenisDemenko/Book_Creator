# Nova (NOVA STUDIO) для Railway — Фаза G3 плану міграції маркетплейсу.
#
# Node 22, а не 20 як в API маркетплейсу: сховище стоїть на вбудованому
# `node:sqlite`, який зʼявився у 22.5. На Node 20 модуля просто немає,
# server/db.ts тихо відкочується на JSON-файли (див. initDb), і застосунок
# працює, але повз базу — тож версія тут не стилістична деталь.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Префікс шляху зашивається у ЗБІРКУ клієнта (шляхи до ассетів), тому
# задається саме тут, а не серед змінних рантайму. Значення за
# замовчуванням тримає образ придатним і для роздачі з кореня.
ARG NOVA_BASE_PATH=/studio/
ENV NOVA_BASE_PATH=$NOVA_BASE_PATH

# Публічна конфігурація Firebase так само потрапляє в бандл на етапі
# збірки — Vite підставляє VITE_*-змінні статично. Секретів тут немає:
# ці значення й так видно в браузері (серверний ключ живе окремо, у
# FIREBASE_PRIVATE_KEY, і в клієнт не потрапляє).
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_NOVA_WS_URL
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_NOVA_WS_URL=$VITE_NOVA_WS_URL

RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# NODE_ENV=production вмикає в server.ts гілку роздачі готового dist/
# замість підняття Vite у режимі middleware.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/package.json package.json

# Обидві теки мають лежати на постійному томі Railway, інакше при кожному
# перезапуску зникають і база, і згенеровані зображення.
ENV DATA_DIR=/data \
    GENERATED_IMAGES_DIR=/data/generated
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "dist/server.mjs"]
