# Розгортання GrabFusion за адресою `fusionlab.in.ua/grabfisionstidio`

Сервіс — окремий Python-процес (FastAPI). Домен `fusionlab.in.ua` належить маркетплейсу, тож
сторінка «живе» під його шляхом, а запити проксуються до сервісу (схема «той самий домен»,
рішення за замовчуванням: токен Studio лишається на сервері, у браузері — лише `httpOnly` cookie).

> Перевірте написання шляху: тут і в налаштуваннях використано `/grabfisionstidio`
> (як у постановці). Якщо мався на увазі `/grabfusionstudio` — змініть лише `GRABFUSION_BASE_PATH`
> і правило проксі; код від шляху не залежить.

## 1. Змінні оточення сервісу

| Змінна | Значення | Навіщо |
|---|---|---|
| `GRABFUSION_BASE_PATH` | `/grabfisionstidio` | публічний префікс: `<base href>`, шлях cookie, зрізання префікса |
| `GRABFUSION_STUDIO_URL` | `https://<studio-host>/api/external/v1` | де живе Studio (частина A) |
| `GRABFUSION_COOKIE_SECURE` | `1` | cookie лише по HTTPS (обовʼязково в проді) |
| `GRABFUSION_MARKET_URL` | `https://fusionlab.in.ua` | посилання на маркетплейс |
| `GRABFUSION_SESSION_DB` | шлях до файлу SQLite | сесії (токени Studio) — на **постійному** диску, інакше після перезапуску всім доведеться підключатись знову |
| `GRABFUSION_HOST` / `GRABFUSION_PORT` | `0.0.0.0` / `8000` | де слухає процес |

Запуск: `pip install .` → `grabfusion`.
Перевірка життя: `GET /healthz`.

## 1а. Railway (той самий проєкт, що й Studio)

1. У проєкті `production` → **New** → **GitHub Repo** → репозиторій Studio (Book_Creator) → назвіть сервіс `grabfusion`.
2. Settings → **Root Directory**: `services/grabfusion` (збірка піде за `Dockerfile`).
3. **Variables:** `GRABFUSION_BASE_PATH=/grabfisionstidio`, `GRABFUSION_COOKIE_SECURE=1`,
   `GRABFUSION_MARKET_URL=https://fusionlab.in.ua`, `GRABFUSION_SESSION_DB=/data/sessions.sqlite3`,
   `GRABFUSION_STUDIO_URL=https://<публічний-домен-Studio>/api/external/v1`
   (порт Railway передає сам через `PORT`, хост у Dockerfile вже `0.0.0.0`).
4. **Volume**: додайте том до сервісу, Mount path `/data` — інакше після кожного деплою сесії викладачів зникнуть.
5. Settings → Networking → **Generate Domain**. Цю адресу (`https://….up.railway.app`) вставте у Vercel як `GRABFUSION_ORIGIN`
   (проєкт маркетплейсу) і зробіть redeploy.
6. Перевірка: `https://<домен-railway>/healthz` → ok; потім `https://fusionlab.in.ua/grabfisionstidio`.

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

## 4. Перевірка після розгортання (руками)

1. `https://fusionlab.in.ua/grabfisionstidio` відкривається; у DevTools → Application: manifest без помилок,
   service worker «activated».
2. Підключення кодом зі Studio; cookie `gf_session` має `Path=/grabfisionstidio`, `Secure`, `HttpOnly`.
3. Android: встановити, відкрити з іконки, зняти фото в режимі літака → «надішлеться, коли зʼявиться звʼязок»,
   увімкнути звʼязок → фото пішло.
4. iPhone: «На початковий екран», відкрити з іконки, те саме.
5. Завантаження великого фото (3000 px) проходить через проксі без 413.

Не перевірено без реального домену: ліміти тіла запиту проксі маркетплейсу, поведінка Safari зі сховищем
після довгої бездіяльності, публікація в магазинах (Google Play через TWA / App Store через обгортку — окремо).
