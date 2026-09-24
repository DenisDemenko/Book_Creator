# Зовнішній API Студії — WriterScan (фото сторінки → текст → книга)

Перший зовнішній застосунок, що передає дані в Студію, — **WriterScan** (iOS):
автор фотографує сторінку рукопису, Студія розпізнає текст, автор перевіряє
його на телефоні й надсилає — і текст приїжджає в медіатеку книги, звідки
одним кліком вставляється в главу AI-чернеткою.

Макет застосунку (WriterScanMVP) мав власний бекенд на AWS (Lambda +
DynamoDB + S3 + Google Cloud Vision) і прямо казав, що без контракту з
наявною платформою запис у її книги неможливий. Цей документ — той контракт.
Від AWS-частини макету відмовились: сховище, медіатека й моделі зору в
Студії вже є.

## Рішення (власник, 24.09.2026)

| Питання | Рішення | Чому |
|---|---|---|
| Як застосунок доводить, хто він | **Особистий токен** (`nst_…`), як GitHub PAT | Нативний вхід через Firebase — окремий великий проєкт; токен створюється в Студії й відкликається там само |
| Чим розпізнавати текст | **Модель зору ядра AI** (модуль «Текст за фото» в «Ядрі AI»), а не Google Cloud Vision | Ключі вже налаштовані, витрати вже логуються; без нового сервісного акаунта й секрету |

## Чому скан НЕ пише в книгу сам

Книга живе в браузері автора (IndexedDB). Серверна копія — дзеркало
(`src/utils/storage.ts → mirrorBookToServer`): наступне збереження з браузера
приймає 409 як «оновити ревізію» і **перезаписує** серверну копію. Секція,
записана прямо на сервер, зникла б за першим натисканням клавіші в Студії.

Тому: застосунок → **«Вхідні» медіатеки** → автор у Студії натискає
«Передати в главу» → текст лягає тим самим шляхом, що й опис фото (#224):
AI-чернетка в кінці вибраної глави, з кнопками «прийняти / відхилити».

## Автентифікація

- Застосунок: `Authorization: Bearer nst_<43 символи base64url>`.
- Токен створює автор: **Медіатека → Скани з телефону → Підключення застосунку**.
  Показується **один раз**; у базі лише SHA-256 хеш і префікс для впізнавання.
- `/api/external/v1/*` приймає **лише** токен. Cookie-сесія Студії там не діє.
- Маршрути Студії (`/api/external-tokens`, `/api/scans/*`) приймають **лише**
  cookie-сесію: токен з телефона не може створити інший токен чи вирішити долю скану.
- Відкликаний токен одразу дає 401 `invalid_token`.
- До 10 чинних токенів на автора.

## Контракт `/api/external/v1`

Усі відповіді — JSON. Помилка: `{ "error": "людський текст", "kind": "машинний_код" }`.

| Метод | Шлях | Тіло → Відповідь |
|---|---|---|
| GET | `/me` | → `{ user: { id, name, email, role } }` |
| GET | `/books` | → `{ books: [{ id, title, updatedAt }] }` — лише книги, що вже збережені на сервері |
| GET | `/books/:bookId/chapters` | → `{ chapters: [{ id, title, order, sectionCount }] }` за `order` |
| POST | `/books/:bookId/scans` | `{ image, mimeType?, filename? }` → **202** `{ scan }` зі `status: "processing"` |
| GET | `/scans/:scanId` | → `{ scan }` — опитувати кожні 2–3 с, доки `status` не `recognized` / `failed` |
| POST | `/scans/:scanId/retry` | → **202** `{ scan }` — лише для `failed`; фото вдруге не надсилається |
| GET | `/scans/:scanId/image` | → байти фото (`image/jpeg` тощо) |
| POST | `/scans/:scanId/submit` | `{ text, chapterId?, chapterTitle?, sectionTitle? }` → `{ scan }` зі `status: "submitted"` |

`image` — `data:image/jpeg;base64,…` або голий base64 разом із `mimeType`.
Підтримуються JPEG, PNG, WEBP (HEIC застосунок має перетворити на JPEG),
до **10 МБ** після декодування; сигнатура файлу перевіряється.

Обʼєкт `scan`:

```json
{
  "scanId": "scn-…", "bookId": "BK-…",
  "status": "processing | recognized | failed | submitted | inserted | dismissed",
  "recognizedText": "що повернула модель (не змінюється)",
  "text": "що автор надіслав після перевірки",
  "chapterId": "…|null", "chapterTitle": "…|null", "sectionTitle": "…|null",
  "modelId": "…|null", "error": "людська причина відмови|null",
  "imageUrl": "/api/media/file/… (для Студії, з cookie)",
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

Життєвий цикл: `processing → recognized | failed` (сервер) →
`submitted` (застосунок; повторний submit до вставки оновлює той самий скан,
`failed` теж можна надіслати — текст, набраний вручну) →
`inserted | dismissed` (Студія). Після цього submit дає 409 `already_resolved`.

`chapterId` перевіряється по книзі (невідомий → 400 `chapter_not_found`), а
назву глави сервер бере з книги, а не з запиту.

### Коди помилок

| HTTP | kind | Коли |
|---|---|---|
| 400 | `bad_image`, `bad_input`, `chapter_not_found` | фото не того типу / порожній текст / чужа глава |
| 401 | `unauthenticated`, `invalid_token` | немає заголовка / токен недійсний чи відкликаний |
| 402 | `quota_exceeded` | вичерпано ліміт сховища тарифу |
| 403 | `forbidden` | роль автора не має `canUseAi` (для сканування) |
| 404 | `book_not_found`, `scan_not_found`, `image_not_found` | чуже або неіснуюче — однаково 404 |
| 409 | `not_ready`, `already_resolved`, `wrong_status` | стан скану не дозволяє дію |
| 413 | `image_too_large`, `text_too_long` | > 10 МБ фото / > 100 000 символів |
| 429 | `rate_limited` | > 60 сканів на годину |

## Студійна половина

- `GET/POST/DELETE /api/external-tokens` — токени (cookie).
- `GET /api/scans/inbox?bookId=` — скани зі станом `submitted`.
- `POST /api/scans/:id/resolve { action: "inserted" | "dismissed" }`.
- UI: `src/components/ScanInboxPanel.tsx` у медіатеці — вхідні (текст можна
  ще раз поправити, вибрати главу, «разом із фото сторінки») і підключення
  застосунку (адреса API, створення/відкликання токенів).

## Розпізнавання

`server/external/scanRecognizer.ts`: модель, привʼязана адміністратором до
модуля `textFromImage` (інакше `GEMINI_MODEL`), має підтримувати зір;
ключ — власний ключ автора → платформний → серверний; виклик через
`aiCore.generateText` (логування витрат із міткою «Скан сторінки з телефону
(WriterScan)»). Промпт — `server/external/scanOcrPrompt.ts`: дослівна
транскрипція, без виправлень стилю й орфографії, `[нерозбірливо]` для
нечитабельного. Розпізнавання йде у фоні (202 + опитування) — урок #210/#215
про обрив довгих запитів проксі хостингу.

## Файли

- `server/external/externalApiStore.ts` — токени й скани (SQLite / JSON).
- `server/external/externalApiRoutes.ts` — маршрути, Bearer-автентифікація.
- `server/external/scanRecognizer.ts`, `server/external/scanOcrPrompt.ts`.
- `server/db.ts` — таблиці `external_api_tokens`, `external_scans`.
- `scripts/test-externalApi.mts` — `npm run test:external-api`.
