# Розгортання GrabFusion за адресою `www.fusionlab.in.ua/grabfisionstidio`

Сервіс — окремий Python-процес (FastAPI). Домен `fusionlab.in.ua` належить маркетплейсу (канонічний хост — `www.`:
`fusionlab.in.ua` без `www` дає 308 на `www.fusionlab.in.ua`, перевірено 04.11.2026), тож
сторінка «живе» під його шляхом, а запити проксуються до сервісу (схема «той самий домен»,
рішення за замовчуванням: токен Studio лишається на сервері, у браузері — лише `httpOnly` cookie).

> Перевірте написання шляху: тут і в налаштуваннях використано `/grabfisionstidio`
> (як у постановці). Якщо мався на увазі `/grabfusionstudio` — змініть лише `GRABFUSION_BASE_PATH`
> і правило проксі; код від шляху не залежить.

## 0. Порядок і передумови (перевірено 04.11.2026)

1. **Studio з маршрутами `photo-drafts` уже на Railway.** Без токена `GET …/api/external/v1/photo-drafts/limits` дає `401` з
   `kind: unauthenticated` (а неіснуючий маршрут того ж префікса віддає `200` — сторінку застосунку), тож маршрут змонтовано.
2. **Маркетплейс:** міграції (`20261030100000_author_bonus` на `master` є; `20261031100000_course_media` — лише у feature-гілках) і
   `PAYOUT_DATA_KEY` потрібні лише для синхронізації курсів з вітриною. Режими «Інструкція», «Глава книги» й «Набір книги»
   (вони йдуть у Studio) від цього, судячи з коду, не залежать — на живій Studio не перевірено; режим «Курс» відправляє чернетку в Studio,
   а далі її публікація залежить від міграції.
3. **Спочатку сервіс на Railway** (розділ 1а) і лише потім змінна `GRABFUSION_ORIGIN` у Vercel з redeploy (розділ 2): правило
   `rewrite` читає її **під час збірки**, зміна без перезбирання нічого не дає — так само, як `NOVA_ORIGIN`.
4. Доки `GRABFUSION_ORIGIN` не задано, `www.fusionlab.in.ua/grabfisionstidio` дає 404 (перевірено), а решта сайту працює як раніше.

## 1. Змінні оточення сервісу

| Змінна | Значення | Навіщо |
|---|---|---|
| `GRABFUSION_BASE_PATH` | `/grabfisionstidio` | публічний префікс: `<base href>`, шлях cookie, зрізання префікса |
| `GRABFUSION_STUDIO_URL` | `https://bookcreator-production-7304.up.railway.app/api/external/v1` | де живе Studio (частина A). Напряму на Railway, а не через `fusionlab.in.ua`: це запити сервер → сервер, Vercel між ними зайвий, а без префікса `/studio` апекс-домен веде в маркетплейс, не в Studio |
| `GRABFUSION_COOKIE_SECURE` | `1` | cookie лише по HTTPS (обовʼязково в проді) |
| `GRABFUSION_MARKET_URL` | `https://www.fusionlab.in.ua` | посилання на маркетплейс. З `www`: клієнт не йде за редиректами, а апекс дає 308 |
| `GRABFUSION_SESSION_DB` | шлях до файлу SQLite | сесії (токени Studio) — на **постійному** диску, інакше після перезапуску всім доведеться підключатись знову |
| `GRABFUSION_HOST` / `GRABFUSION_PORT` | `0.0.0.0` / `8000` | де слухає процес |

Запуск: `pip install .` → `grabfusion`.
Перевірка життя: `GET /healthz`.

## 1а. Railway (той самий проєкт, що й Studio)

1. У проєкті `comfortable-caring` (там живе сервіс `Book_Creator`) → **New** → **GitHub Repo** → репозиторій Studio (Book_Creator) →
   назвіть сервіс `grabfusion`.
2. Settings → **Root Directory**: `services/grabfusion` (збірка піде за `Dockerfile`). Окремий `railway.json` у цій теці задає
   перевірку живості `/healthz` і **Watch Paths** `/services/grabfusion/**`, щоб пуші Studio не перезбирали GrabFusion, а
   поведінка не залежала від того, чий `railway.json` — цей чи корінний від Studio — підхопить Railway.
   Без GitHub: `railway up` із теки `services/grabfusion` (так розгорнуто 05.11.2026: сервіс `grabfusion` у `comfortable-caring`, домен
   `https://grabfusion-production.up.railway.app`); оновлення тоді — повторний `railway up`, автодеплою немає.
3. **Variables:** `GRABFUSION_BASE_PATH=/grabfisionstidio`, `GRABFUSION_COOKIE_SECURE=1`,
   `GRABFUSION_MARKET_URL=https://fusionlab.in.ua`, `GRABFUSION_SESSION_DB=/data/sessions.sqlite3`,
   `GRABFUSION_STUDIO_URL=https://<публічний-домен-Studio>/api/external/v1`
   (порт Railway передає сам через `PORT`, хост у Dockerfile вже `0.0.0.0`).
4. **Volume**: додайте том до сервісу, Mount path `/data` — інакше після кожного деплою сесії викладачів зникнуть.
5. Settings → Networking → **Generate Domain**. Цю адресу (`https://….up.railway.app`, без слеша в кінці — зайвий слеш правило
   прибирає саме) вставте у Vercel як `GRABFUSION_ORIGIN` (проєкт маркетплейсу, Production) і зробіть **Redeploy**: потрібне саме перезбирання,
   а не лише збереження змінної. У Build Logs має бути рядок
   `[next.config] GRABFUSION_ORIGIN = … — rewrite /grabfisionstidio увімкнено`.
6. Перевірка: `https://<домен-railway>/healthz` → ok; потім `https://www.fusionlab.in.ua/grabfisionstidio`.
   Діагностика, як для `/studio`: `curl -sD- https://www.fusionlab.in.ua/grabfisionstidio` і заголовок `X-Matched-Path` —
   `/404` означає, що правила в збірці немає.

## 2. Проксі з маркетплейсу

Правило: усе, що починається з `/grabfisionstidio`, іде на сервіс GrabFusion **без зміни cookie й
заголовків**. Сервіс сам зрізає префікс, тож підходять обидва варіанти — і проксі, що прибирає
префікс (`/grabfisionstidio/api/x` → `/api/x`), і проксі, що передає шлях як є.

Приклад nginx:

```nginx
location /grabfisionstidio/ {
    proxy_pass http://grabfusion:8000;   # без префікса — або з ним, обидва працюють
    client_max_body_size 12m;            # фото ≤ 2048 px, але з запасом
    proxy_read_timeout 90s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location = /grabfisionstidio { return 301 /grabfisionstidio/; }
```

Для Rewrite-правил хостингу маркетплейсу (Next.js/Vercel/Railway): `source: /grabfisionstidio/:path*`
→ `destination: https://<grabfusion-host>/:path*`. Перевірте: (а) ліміт тіла запиту хостингу
не менший за ~5 МБ (фото стискаються в браузері, зазвичай < 1 МБ); (б) `Set-Cookie`
і `Cookie` проходять наскрізь; (в) відповіді `/api/*` не кешуються проксі.

## 3. Що робить PWA

- `GET /grabfisionstidio/manifest.webmanifest` — назва, кольори Fusion Lab, `start_url`/`scope` відносні (`./`),
  іконки 192/512/maskable. `GET /grabfisionstidio/sw.js` — service worker (версія = відбиток статики,
  тому оновлення файлів саме оновлює кеш).
- Без звʼязку відкривається **оболонка** сторінки (екран «Немає звʼязку» з лічильником фото в черзі).
  Дані й фото (`/api/*`) **ніколи не кешуються** — це приватні дані викладача. Нові фото, зняті без
  звʼязку, лежать у черзі IndexedDB і надсилаються, коли звʼязок повернувся (і при поверненні в застосунок).
- Service worker працює лише по **HTTPS** (або localhost): без нього встановлення не пропонується.
- Android (Chrome): кнопка «Встановити» зʼявляється в шапці, коли Chrome дозволяє встановлення;
  інакше меню браузера → «Встановити застосунок». iPhone/iPad (Safari): окремої кнопки немає, сторінка один раз
  показує підказку «Поділитися → На початковий екран».

## 3а. Що перевірено до розгортання (04.11.2026) і чого ні

Перевірено на цій машині, Docker Desktop 29.7, образ зібрано з цього `Dockerfile` за 69 с. Повторити: `scripts/container-smoke.sh`
(потрібен Docker; сам збирає образ і піднімає мок Studio).

- Контейнер запускається так, як Railway: порт лише в `PORT` (без `GRABFUSION_PORT`), хост `0.0.0.0` з Dockerfile, префікс
  `/grabfisionstidio`, `GRABFUSION_COOKIE_SECURE=1`, сесії в `/data/sessions.sqlite3` на томі.
- `/healthz`, сторінка за `/grabfisionstidio` (без слеша — саме так її віддає правило rewrite) і за `/`, `<base href="/grabfisionstidio/">`,
  manifest, `sw.js` (JavaScript, `no-cache`) — усе `200`.
- Підключення кодом до Studio (у мока): cookie `gf_session` з `HttpOnly; Secure; SameSite=strict; Path=/grabfisionstidio`,
  токен Studio у відповідь браузеру не потрапляє; помилки Studio (`404` невірний код, `400` порожній) доходять до користувача.
- Сесія переживає `docker restart` контейнера (том `/data`).
- Тіло 3 МБ доходить до застосунку (відповідь `422` від валідації, не `413`).
- Правило проксі (коміт `feat/grabfusion-proxy`, перенесений на актуальний `master` маркетплейсу без конфліктів): `rewrites()`
  з обома змінними дає `/grabfisionstidio` і `/grabfisionstidio/:path*` перед `/studio`; без `GRABFUSION_ORIGIN` правила немає;
  `typecheck` маркетплейсу — без помилок.
- Наскрізно через справжній Next (`next dev --webpack` з цим правилом → контейнер GrabFusion → мок Studio): сторінка, manifest, `sw.js`,
  `static/app.js` — `200`; редиректу на `/uk` чи `/en` немає (matcher у `proxy.ts` працює); `POST /api/pair` через Next віддає
  `Set-Cookie` з `HttpOnly; Secure; SameSite=strict; Path=/grabfisionstidio` без змін; сесійний запит з цією cookie — `200`;
  тіло 3 МБ доходить до застосунку.

**Не перевірено** (потребує справжніх доменів і пристроїв): ліміт тіла запиту на Vercel для правил `rewrite` на зовнішній
сервер; `Set-Cookie` через справжній Vercel; справжня Studio (лише мок-сервер: коди підключення на проді не видавались);
камера, service worker і встановлення PWA на Android/iPhone; робота за `https` (тут `http` на localhost).

## 4. Перевірка після розгортання

Автоматична частина (лише читання, без облікових даних): `scripts/post-deploy-check.sh https://www.fusionlab.in.ua/grabfisionstidio`.
Додайте `--with-studio`, щоб ще й надіслати у Studio один хибний код підключення і так перевірити `GRABFUSION_STUDIO_URL`
(кожна така перевірка враховується в лічильнику спроб Studio). Нижче — те, що скрипт перевірити не може:

1. `https://www.fusionlab.in.ua/grabfisionstidio` відкривається; у DevTools → Application: manifest без помилок,
   service worker «activated».
2. Підключення кодом зі Studio; cookie `gf_session` має `Path=/grabfisionstidio`, `Secure`, `HttpOnly`.
3. Android: встановити, відкрити з іконки, зняти фото в режимі літака → «надішлеться, коли зʼявиться звʼязок»,
   увімкнути звʼязок → фото пішло.
4. iPhone: «На початковий екран», відкрити з іконки, те саме.
5. Завантаження великого фото (3000 px) проходить через проксі без 413.

Не перевірено без реального домену: ліміти тіла запиту проксі маркетплейсу, поведінка Safari зі сховищем
після довгої бездіяльності, публікація в магазинах (Google Play через TWA / App Store через обгортку — окремо).
