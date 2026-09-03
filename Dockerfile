# Nova (NOVA STUDIO) для Railway — Фаза G3 плану міграції маркетплейсу.
#
# Node 22, а не 20 як в API маркетплейсу: сховище стоїть на вбудованому
# `node:sqlite`, який зʼявився у 22.5. На Node 20 модуля просто немає,
# server/db.ts тихо відкочується на JSON-файли (див. initDb), і застосунок
# працює, але повз базу — тож версія тут не стилістична деталь.
FROM node:22-bookworm-slim AS build
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

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ---------------------------------------------------------------------------
# Рушії PDF, які живуть не в node_modules, а в системі (log.md #101).
#
# ЧОМУ БАЗА БІЛЬШЕ НЕ ALPINE. Образ важив десятки мегабайтів і був alpine
# саме тому, що нічого системного не потребував. Тепер потребує: власник
# вирішив, що письменник обирає рушій верстки, а два з чотирьох рушіїв —
# це зовнішні програми. Chromium і TeX Live на Debian — протоптана дорога
# з готовими пакетами; на Alpine той самий набір складався б уручну, і
# кожен деплой залежав би від того, чи зійшлись версії musl-збірок.
#
# ЦІНА НАЗВАНА ЧЕСНО: образ виростає на кілька гігабайтів, і **кожен**
# деплой Nova стає повільнішим — включно з деплоями, які до верстки не
# мають стосунку. Це свідоме рішення власника від 03.09.2026, а не
# недогляд.
#
# ПРО ПЕРЕЛІК TEXLIVE. Він не «про всяк випадок»: кожен пакет тут доданий
# після конкретної помилки збірки шаблону Eisvogel, перевіреної запуском:
#   lmodern                    → File `lmodern.sty' not found
#   texlive-lang-cyrillic      → Package babel Error: Unknown option 'ukrainian'
#   texlive-fonts-extra        → File `sourcesanspro.sty' not found
#   texlive-fonts-recommended  → базові гарнітури, потрібні решті
#   texlive-latex-extra        → mdframed, awesomebox та інше з шаблону
# fonts-dejavu — та сама гарнітура, що вбудована у власний рушій PDF, тож
# усі чотири рушії дають однакову кирилицю, а не чотири різні.
# ---------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
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

# Шлях до браузера. Пакет Debian ставить його як /usr/bin/chromium, тоді як
# усталене значення в коді — /usr/bin/chromium-browser (назва з Alpine).
ENV CHROMIUM_PATH=/usr/bin/chromium

# NODE_ENV=production вмикає в server.ts гілку роздачі готового dist/
# замість підняття Vite у режимі middleware.
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist dist
COPY --from=build /app/package.json package.json

# ---------------------------------------------------------------------------
# Файли даних, які потрібні серверу в рантаймі.
#
# ЦЕ ВИПРАВЛЕННЯ ДАВНЬОЇ ВАДИ, А НЕ НОВА ПОТРЕБА. Сервер збирається в один
# `dist/server.mjs`, і шрифти PDF шукаються поруч із ним — а сюди їх ніхто
# ніколи не копіював. Тобто на розгорнутому Nova власна верстка PDF мала
# падати з «Шрифти для PDF не знайдено в /app/dist/fonts», хоч локально
# (`npm run dev`) працювала: там шлях веде у вихідну теку. Знайдено при
# складанні цього ж Dockerfile.
# ---------------------------------------------------------------------------
COPY --from=build /app/server/pdf/fonts dist/fonts
COPY --from=build /app/server/pdf/latex dist/latex

# Обидві теки мають лежати на постійному томі, інакше при кожному
# перезапуску зникають і база, і згенеровані зображення.
#
# Інструкції `VOLUME ["/data"]` тут свідомо НЕМАЄ: Railway відхиляє образ
# із нею ще на етапі розбору Dockerfile («docker VOLUME is not supported,
# use Railway Volumes») — том підключається в самому сервісі, через
# Settings → Volumes, з точкою монтування /data. Ці дві змінні лишаються:
# вони лише кажуть застосунку, куди писати, і працюють однаково і з
# томом Railway, і зі звичайним `docker run -v` у локальному запуску.
ENV DATA_DIR=/data \
    GENERATED_IMAGES_DIR=/data/generated

EXPOSE 3000
CMD ["node", "dist/server.mjs"]
