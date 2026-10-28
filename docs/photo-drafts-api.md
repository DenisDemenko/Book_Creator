# API «чернеток за фото» (Studio ↔ GrabFusion), контракт 1.2.0

Крок A0 плану `docs/proposals/GRABFUSION_PHOTO_COURSE_APP_2026-10-28.md`. Цей опис, типи
`shared/photoDraftContract.ts`, схема `docs/photo-drafts-api/schema.json` (JSON Schema draft-07) і
фікстури `docs/photo-drafts-api/fixtures/*.json` — **єдине джерело стику** частин A (сервер Studio) і
B (Python-сервіс GrabFusion). Їхню узгодженість перевіряє `npm run test:photo-draft-contract`.

Стан: **усі маршрути реалізовано** — етап 1 (A1) і етап 3 (A2: `structure`, `generate`, `submit`),
28.10.2026, `server/external/photoDraftRoutes.ts`. Справжні відповіді сервера перевіряються цією ж
схемою в `npm run test:photo-drafts` і `npm run test:photo-drafts-a2`.

## 1. Загальне

- **Адреса:** `https://<studio>/api/external/v1`. Усі шляхи нижче — відносно неї.
- **Автентифікація:** лише `Authorization: Bearer nst_…`. Cookie-сесія Studio тут не приймається.
  Токен тримає сервер GrabFusion; у браузер викладача він не потрапляє.
- **Підключення:** викладач у Studio (Медіатека → Скани з телефону → Підключення застосунку) натискає
  «Код підключення GrabFusion» і бачить одноразовий код (5 хвилин). Під капотом — наявний
  `POST /api/external-tokens/pairing-code` з `{ "scope": "photo-drafts" }`. GrabFusion обмінює його на токен наявним маршрутом `POST /pair`
  (`{ "code": "…" }` → `201 { token, record, user }`). Токен, виданий для GrabFusion, має область
  `photo-drafts` (зʼявляється в A1): з нею відкриті лише маршрути цього опису та `GET /me`;
  до книг автора такий токен доступу не має (`403 scope_denied`).
- **Формат:** JSON у UTF-8. Дати — ISO 8601 в UTC (`2026-10-28T10:00:00.000Z`).
- **Помилки:** завжди `{ "error": "<текст для людини, українською>", "kind": "<код>" }`. Застосунок
  розгалужується **лише за `kind`**; текст можна показати викладачу як є. Це той самий формат, що
  в решті зовнішнього API Studio (скани WriterScan).
- **Сумісність:** нові поля можуть зʼявлятися будь-коли — клієнт мусить ігнорувати невідомі поля.
  Схема дозволяє додаткові властивості саме тому.

## 2. Межі

`GET /photo-drafts/limits` → `200` (фікстура `limits.json`). Застосунок бере межі звідси, а не тримає
власну копію.

| Межа | Значення | Що означає |
|---|---|---|
| `maxNoteChars` | 500 | Опис кадру або серії, у символах Unicode |
| `maxImageBytes` | 10 МБ | Одне фото після декодування base64 |
| `recommendedMaxSidePx` | 2048 | До цього застосунок стискає фото (Pillow) і прибирає EXIF/GPS |
| `maxPhotosPerDraft` | 300 | Кадрів в одній чернетці |
| `photosPerHour` | 120 | Нових фото на годину на автора |
| `maxOpenDrafts` | 20 | Чернеток, ще не відправлених і не відкинутих |
| `maxTitleChars` / `maxShortFieldChars` | 160 / 200 | Назва; ремесло й аудиторія |
| `maxLessonBodyChars` | 20 000 | Текст уроку |
| `pollIntervalMs` | 2000 | Як часто опитувати під час фонових робіт |

**Як рахувати символи.** Кодові точки Unicode: у TypeScript `[...text].length`
(`countNoteChars` у контракті), у Python — `len(text)`. «👍» — один символ. Лічильник у застосунку й
перевірка сервера мусять збігатися; рівно 500 символів — дозволено, 501 — `400 note_too_long`.

## 3. Чернетка

Обʼєкт `draft` (`definitions/Draft` у схемі) повертають майже всі маршрути. Головне:

- `kind`: `course` → курс у статусі draft; `instruction` → експрес-чернетка інструкції;
  `book` → глава у «Вхідних» книги (потрібен `bookId`).
- `status`: `collecting` → `structured` → `written` → `submitted`; будь-який, крім `submitted`,
  може стати `discarded`. Повернення назад дозволене: нові фото в `structured` повертають
  чернетку в `collecting`; нова структура в `written` — у `structured`.
- `revision` — збільшується з кожною дією викладача (з будь-якого пристрою). `PATCH` надсилає
  `ifRevision`. Фонові результати ШІ (опис кадру, завершення проходу) ревізію **не** змінюють, тож
  правка під час опису кадрів не конфліктує.
- `photos[]` — кадри з `status` `processing` → `described` | `failed`, порядком `order` (з 1),
  описом проходу 1 `description` і мітками `tags`.
- `notes[]` — описи викладача: `{ noteId, photoIds, text }`; один кадр або серія.
- `structure` — модулі й уроки після проходу 2 (`null` до того); у уроках — `body` після проходу 3.
  `aiFields` перелічує поля, які написав ШІ й викладач ще не правив.
- `assumptions[]` — що ШІ припустило й викладач має підтвердити (`open` / `confirmed` / `rejected`).
- `job` — фонова робота (`structure` або `generate`), `running` або `failed` з причиною; `null`,
  коли нічого не виконується.
- `submitted` — куди лягла чернетка після відправки (`course` / `express` / `inbox`, `id`,
  `studioUrl`). `studioUrl` — відносний шлях у Studio, застосунок лише відкриває його як посилання;
  точні шляхи фіксує етап 3.

## 4. Маршрути

| Маршрут | Етап | Успіх | Фікстура |
|---|---|---|---|
| `GET /photo-drafts/limits` | 1 | 200 | `limits` |
| `GET /photo-drafts` | 1 | 200 | `list-drafts` |
| `POST /photo-drafts` | 1 | 201 | `create-draft` |
| `GET /photo-drafts/:draftId` | 1 | 200 | `get-draft-collecting`, `get-draft-structured`, `get-draft-written`, `get-draft-job-failed` |
| `PATCH /photo-drafts/:draftId` | 1 | 200 | `patch-draft` |
| `DELETE /photo-drafts/:draftId` | 1 | 200 | `discard-draft` |
| `POST /photo-drafts/:draftId/photos` | 1 | 202 | `add-photo` |
| `GET /photo-drafts/:draftId/photos/:photoId/image` | 1 | 200 | байти зображення |
| `POST /photo-drafts/:draftId/photos/:photoId/retry` | 1 | 202 | `retry-photo` |
| `DELETE /photo-drafts/:draftId/photos/:photoId` | 1 | 200 | `delete-photo` |
| `PUT /photo-drafts/:draftId/notes/:noteId` | 1 | 200 | `put-note` |
| `DELETE /photo-drafts/:draftId/notes/:noteId` | 1 | 200 | `delete-note` |
| `POST /photo-drafts/:draftId/structure` | 3 | 202 | `structure-running` |
| `POST /photo-drafts/:draftId/modules/:moduleId/generate` | 3 | 202 | `generate-running` |
| `POST /photo-drafts/:draftId/submit` | 3 | 201 | `submit-course`, `submit-instruction`, `submit-book` |

Подробиці:

- **`POST /photo-drafts`** — тіло `{ kind, title?, craft?, audience?, level?, bookId?, instructionMode?, modelCode? }`.
  `instructionMode` (`assembly` — складання, `operation` — користування; без нього `assembly`) і `modelCode`
  (код або модель виробу) — для `kind: instruction`; режим у курсу чи книги → `400 bad_input`.
  `bookId` обовʼязковий для `book` і має бути книгою автора (`404 book_not_found`). Понад
  `maxOpenDrafts` → `409 too_many_drafts`.
- **`GET /photo-drafts`** — перелік власних чернеток (`drafts[]`, коротко), новіші перші; відкинуті
  (`discarded`) не показуються.
- **`PATCH /photo-drafts/:draftId`** — тіло `{ ifRevision, title?, craft?, audience?, level?,
  instructionMode?, modelCode?, photoOrder?, structure?, lessons?, assumptions? }`. `photoOrder` — усі `photoId` у новому порядку
  (інший набір → `400 bad_input`). `structure` замінює структуру повністю; `lessons` правлять окремі
  уроки (`{ lessonId, title?, goal?, body?, topics? }`); поле, яке викладач змінив, зникає з
  `aiFields`. `assumptions` — `[{ assumptionId, status }]`. Ревізія на сервері інша →
  `409 revision_conflict`: застосунок перечитує чернетку й показує викладачу, що змінилось.
- **`DELETE /photo-drafts/:draftId`** — відкинути (`status: discarded`); відправлену — `409 wrong_status`.
- **`POST /photo-drafts/:draftId/photos`** — тіло `{ clientId, image, mimeType?, takenAt? }`;
  `image` — `data:image/jpeg;base64,…` або голий base64 разом із `mimeType`; JPEG, PNG, WEBP
  (інакше `400 bad_image`; понад межу — `413 image_too_large`). **Ідемпотентно за `clientId`**:
  повтор після обриву звʼязку повертає те саме фото з `duplicate: true` і не створює дубля — саме на
  цьому стоїть черга без звʼязку. Відповідь `202 { photo, revision, duplicate }`, фото в стані
  `processing`; опис (прохід 1) іде у фоні, застосунок опитує `GET /photo-drafts/:draftId`. Понад
  `maxPhotosPerDraft` → `409 too_many_photos`; понад `photosPerHour` → `429 rate_limited`; вичерпано
  сховище тарифу → `402 quota_exceeded`; вичерпано ліміт ШІ-витрат →
  `402 ai_budget_exceeded` (перевіряється ДО збереження фото). Роль без дозволу на ШІ → `403 forbidden`.
- **`GET …/photos/:photoId/image`** — байти фото з тим самим токеном (у застосунку немає cookie).
- **`POST …/photos/:photoId/retry`** — повторити опис після `failed` (інший стан → `409 wrong_status`).
- **`DELETE …/photos/:photoId`** — прибрати кадр; він зникає також з описів і уроків.
- **`PUT …/notes/:noteId`** — тіло `{ photoIds, text }`. `noteId` задає застосунок, тож повтор
  безпечний. Текст понад 500 символів → `400 note_too_long`; невідомий кадр → `404 photo_not_found`.
  Відповідь `{ note, revision }`. Опис, змінений після проходу 1, сервер враховує в наступних проходах.
- **`DELETE …/notes/:noteId`** — прибрати опис (`404 note_not_found`, якщо немає).
- **`POST …/structure`** (прохід 2) — розкласти кадри на модулі й уроки. Тіло необовʼязкове:
  `{ "replace": true }`. Відповідь `202 { draft }` з `job: { kind: "structure", status: "running" }`;
  після завершення `job` стає `null`, а `status` — `structured`. Поки триває робота, інші довгі
  запити → `409 job_running`. Кадри ще описуються або їх немає → `409 wrong_status`. Структура вже
  є → `409 wrong_status`, доки не передано `replace: true` (тоді її й припущення буде замінено, а
  правки викладача в ній втрачено). ШІ повертає й `assumptions` (усі `open`); якщо в чернетки не
  було назви, ШІ пропонує її. Кадр, якого модель не розмістила, сервер кладе до уроку попереднього
  за порядком кадру: кожен кадр завжди в рівно одному уроці. Кадри, додані чи прибрані під час
  роботи, враховуються при її завершенні.
- **`POST …/modules/:moduleId/generate`** (прохід 3) — написати текст одного модуля (`404
  module_not_found`; без структури `409 wrong_status`). ШІ пише `body`, а за потреби й `goal` та
  `topics` лише в тих полях, які викладач не правив (поле, яке він змінив, лишається його, а `aiFields`
  показує, що саме від ШІ). Може додати нові `open`-припущення. Коли написано всі модулі, `status`
  стає `written`; стерти текст уроку через PATCH — значить повернути модуль у «не написано».
- **`POST …/submit`** — перевірка якості, потім створення результату. Відповідь
  `201 { draft, target }`. Якщо щось заважає — `400 submit_blocked` з переліком `blockers[]`
  (`no_photos`, `photos_processing`, `photos_failed`, `no_structure`, `module_not_written`,
  `open_assumptions`, `empty_lesson`, `title_missing`, `book_missing`), кожен із `message` і, де
  доречно, `moduleId` / `lessonId` / `photoId` / `assumptionId`. Нові кадри після структури
  (`status: collecting`) — теж `no_structure`: розкладіть заново. Повторний submit відправленої
  чернетки → `409 wrong_status`; два одночасні submit створюють один результат. Що виходить:
  - `course` → чернетка курсу в Studio (`/courses/<id>`), лише `draft`: модулі, уроки (текст — в
    описі уроку), фото уроків із медіатеки автора, перший кадр як обкладинка. Ціну, категорію й
    відео автор додає в Studio.
  - `instruction` → експрес-чернетка майстра «Інструкція з фото й техдокументації» Studio
    (`/express/<id>`), у ній уже **готова пропозиція кроків**: кожен крок — на власному
    підтвердженому джерелі з кадром (не більше 20 кроків-джерел; зайві дописуються до останнього),
    режим і код виробу — з чернетки. Рядки тексту кроку «**Деталі:** …», «**Інструменти:** …»,
    «**Увага:** …», «**Результат кроку:** …» стають полями кроку; крок, текст якого написав ШІ й
    викладач не правив, у майстрі позначено «потребує перевірки». Експрес-чернетки живуть 24 години —
    застосунок має сказати викладачу відкрити її в Studio протягом доби.
  - `book` → «Вхідні» книги (`/media?tab=inbox&bookId=<id>`): по запису на урок (текст уроку, назва
    модуля як глава, назва уроку як розділ); `target.id` — перший із записів.

**Опитування.** Поки є фото в `processing` або `job.status = running`, застосунок раз на
`pollIntervalMs` читає `GET /photo-drafts/:draftId`. Довгі роботи навмисно не тримають запит:
проксі хостингу обриває запити довше ~90 секунд (502).

**Завислі роботи.** Робота ШІ, що «біжить» понад 10 хвилин (сервер міг перезапуститись), у відповідях
вже `job.status = failed` з поясненням — її можна запустити знову, повторюючи те саме `POST`.

## 5. Коди помилок

| `kind` | HTTP | Коли |
|---|---|---|
| `unauthenticated` | 401 | Немає заголовка `Authorization: Bearer` |
| `invalid_token` | 401 | Токен недійсний, відкликаний або акаунт недоступний |
| `scope_denied` | 403 | Токен не має області `photo-drafts` (або навпаки — токен GrabFusion пробує інші маршрути) |
| `forbidden` | 403 | Роль автора не має дозволу на функції ШІ (визначає адміністратор Studio) |
| `bad_input` | 400 | Невалідне тіло запиту |
| `bad_image` | 400 | Не JPEG/PNG/WEBP або дані не є зображенням |
| `image_too_large` | 413 | Фото понад `maxImageBytes` |
| `note_too_long` | 400 | Опис понад 500 символів |
| `too_many_photos` | 409 | Понад `maxPhotosPerDraft` |
| `too_many_drafts` | 409 | Понад `maxOpenDrafts` |
| `rate_limited` | 429 | Понад `photosPerHour` |
| `quota_exceeded` | 402 | Вичерпано сховище тарифу |
| `ai_budget_exceeded` | 402 | Вичерпано ліміт ШІ-витрат тарифу викладача (прохід ШІ оплачується з його тарифу) |
| `draft_not_found` | 404 | Чернетки немає або вона чужа |
| `photo_not_found` | 404 | Кадру немає в цій чернетці |
| `note_not_found` | 404 | Опису немає |
| `module_not_found` | 404 | Модуля немає в структурі |
| `book_not_found` | 404 | Книги немає або вона чужа |
| `wrong_status` | 409 | Дія недоступна в поточному стані чернетки чи фото |
| `job_running` | 409 | Уже виконується фонова робота |
| `revision_conflict` | 409 | `ifRevision` не збігається з ревізією на сервері |
| `submit_blocked` | 400 | Відправка неможлива; деталі в `blockers[]` |
| `server_error` | 500 | Внутрішня помилка; можна повторити пізніше |

Чуже — завжди `404`, а не `403`: застосунок не дізнається, що чужа чернетка існує.

## 6. Маркетплейс (лише читання)

GrabFusion читає **публічні** маршрути каталогу маркетплейсу без ключа мосту (наприклад, сторінку
курсу за slug). Писати у вітрину може лише Studio. Якщо потрібного публічного маршруту немає —
B просить A коментарем у документі плану.

## 7. Для частини B

- Мок-сервер віддає фікстури з `docs/photo-drafts-api/fixtures/` за таблицею розділу 4; помилки —
  фікстури `error-*.json`.
- Перевіряйте власні моделі даних проти `schema.json` (наприклад, бібліотекою `jsonschema`).
- Запит на зміну контракту — коментарем у документі плану; A відповідає, додає фікстуру й запис у
  журнал змін нижче.

## 8. Журнал змін контракту

| Версія | Дата | Зміна |
|---|---|---|
| 1.2.0 | 2026-10-28 | A4: для `kind: instruction` — `instructionMode` (`assembly` / `operation`) і `modelCode` у чернетці, при створенні й у PATCH; відправка інструкції дає готову пропозицію кроків у майстрі технічних інструкцій. Лише додавання |
| 1.1.0 | 2026-10-28 | A2: `POST …/structure` приймає необовʼязкове `{ replace }`; описано поведінку проходів 2–3, відправки (курс / експрес-чернетка / «Вхідні»), завислих робіт. Лише додавання |
| 1.0.0 | 2026-10-28 | Перша версія (A0): чернетки, фото, описи, проходи 2–3, відправка, межі, коди помилок; до G1 додано `forbidden`, `ai_budget_exceeded` і правило ревізії для фонових результатів |
