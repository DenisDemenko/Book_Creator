/**
 * SQLite-сховище NOVA STUDIO.
 *
 * Використовує вбудований у Node модуль `node:sqlite` (доступний з Node 22.5),
 * тож не потребує ані нової залежності, ані нативної збірки — це важливо
 * для розробки під Windows, де node-gyp регулярно псує життя.
 *
 * Якщо середовище старіше й модуля немає, `isAvailable()` поверне false,
 * і сховище прозоро відкотиться на попередні JSON-файли (server/storeJson.ts).
 *
 * Схема свідомо проста: чотири таблиці без зовнішніх ключів між сесіями
 * та користувачами — видалення користувача чистить сесії явним запитом,
 * бо так поведінка залишається однаковою в обох бекендах.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
export const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'nova-studio.db');

/** Мінімальний контракт, спільний для node:sqlite і better-sqlite3. */
interface Statement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close?(): void;
}

let db: Database | null = null;
let available: boolean | null = null;
let unavailableReason = '';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  password_hash TEXT,
  google_id     TEXT,
  -- Firebase Auth (Фаза G1) — UID виданий Firebase, замінює власні паролі
  -- як спосіб впізнати повторний вхід. NULL для рядків, ще не привʼязаних
  -- (див. migrateUsersColumns нижче для баз, створених до цієї колонки).
  firebase_uid  TEXT,
  avatar_url    TEXT,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);
-- Унікальний індекс на firebase_uid НАВМИСНО не тут, а в
-- migrateUsersColumns(): для бази, створеної до Фази G1, колонки ще немає в
-- момент виконання цього SCHEMA, і CREATE INDEX впав би з "no such column",
-- завалив би весь initDb() і тихо перевів сховище на JSON-файли. Міграція
-- йде після SCHEMA і створює індекс уже напевно маючи колонку — тож індекс
-- має рівно одне місце створення, спільне для нових і старих баз.

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS usage_log (
  id         TEXT PRIMARY KEY,
  timestamp  TEXT NOT NULL,
  user_id    TEXT,
  user_email TEXT NOT NULL,
  role       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  engine_id  TEXT NOT NULL,
  model_id   TEXT NOT NULL,
  image_size TEXT,
  cost_usd   REAL NOT NULL DEFAULT 0,
  context    TEXT,
  book_id    TEXT,
  success    INTEGER NOT NULL DEFAULT 1,
  bytes      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_user      ON usage_log(user_id);

-- Хто «власник» (письменник) книги — потрібно лише для того, щоб дозволяти
-- надсилати cowork-запрошення лише йому (і адміну). Створюється лениво:
-- першим запитом на запрошення від ролі writer/admin для цього bookId.
CREATE TABLE IF NOT EXISTS book_collab_owners (
  book_id       TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Запрошення дизайнера/видавця/перекладача до конкретної книги поштою.
CREATE TABLE IF NOT EXISTS book_collab_invites (
  id                TEXT PRIMARY KEY,
  book_id           TEXT NOT NULL,
  book_title        TEXT NOT NULL,
  inviter_user_id   TEXT NOT NULL,
  invitee_email     TEXT NOT NULL COLLATE NOCASE,
  role              TEXT NOT NULL,
  token             TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending',
  email_sent        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  accepted_at       TEXT,
  accepted_user_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_invites_book  ON book_collab_invites(book_id);
CREATE INDEX IF NOT EXISTS idx_invites_token ON book_collab_invites(token);

CREATE TABLE IF NOT EXISTS role_overrides (
  role        TEXT PRIMARY KEY,
  permissions TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Підписка користувача. По одному активному запису на користувача:
-- новий checkout перезаписує попередній (upsert по user_id).
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id             TEXT PRIMARY KEY,
  plan                TEXT NOT NULL DEFAULT 'free',
  billing_cycle       TEXT NOT NULL DEFAULT 'monthly',
  status              TEXT NOT NULL DEFAULT 'active',
  current_period_start TEXT,
  current_period_end  TEXT,
  provider            TEXT,
  provider_ref        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Файл «ім'я_автора.md»: AI-аналіз авторського стилю (Фаза 1, 1.1). По
-- одному запису на користувача — повторна генерація перезаписує вміст.
CREATE TABLE IF NOT EXISTS user_styles (
  user_id        TEXT PRIMARY KEY,
  content_md     TEXT NOT NULL,
  auto_use_style INTEGER NOT NULL DEFAULT 0,
  source_chars   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Шаблони промтів автора («Конструктор промтів» в AI-асистенті). По
-- одному запису на користувача: усі його шаблони лежать одним JSON, бо
-- читаються й пишуться завжди разом, а окрема таблиця з рядком на шаблон
-- дала б лише зайві JOIN'и. Глобальний (адмінський) шар лежить не тут, а
-- у таблиці meta під ключем PROMPT_TEMPLATES_META_KEY
-- (server/promptTemplates.ts): він один на всю систему, і користувацького
-- ключа в нього немає.
CREATE TABLE IF NOT EXISTS user_prompt_templates (
  user_id    TEXT PRIMARY KEY,
  templates  TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Журнал спроб оплати (і LiqPay, і PayPal) — для звірки та підтримки.
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  provider      TEXT NOT NULL,
  plan          TEXT NOT NULL,
  billing_cycle TEXT NOT NULL,
  amount        REAL NOT NULL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL,
  external_id   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

-- Чат-сесії AI-асистента письменника. До цього історія жила лише в
-- localStorage браузера (Фаза 3.2) — тепер вона переживає зміну пристрою.
-- title формується з першої репліки автора; лічильники токенів і вартості
-- накопичуються по сесії, щоб не перераховувати їх агрегатом на кожен показ.
CREATE TABLE IF NOT EXISTS chat_sessions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL,
  title              TEXT NOT NULL,
  book_id            TEXT,
  model_id           TEXT NOT NULL,
  total_input_tokens  INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd     REAL NOT NULL DEFAULT 0,
  message_count      INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);

-- Окремі репліки сесії. Вартість зберігаємо на рівні репліки асистента —
-- так «накопичена вартість сесії» завжди звіряється як SUM(cost_usd), а не
-- лише як лічильник, який міг розійтися з реальністю.
CREATE TABLE IF NOT EXISTS chat_messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  role          TEXT NOT NULL,
  content       TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);

-- Власні ключі API користувача для чат-сесій (Pro/Ultra можуть підставити
-- свій ключ провайдера замість спільного серверного, server/chatProviders.ts).
-- encrypted_key зберігається лише в зашифрованому вигляді (server/userApiKeyCrypto.ts);
-- fingerprint — короткий hash для показу в інтерфейсі без розшифрування.
CREATE TABLE IF NOT EXISTS user_api_keys (
  user_id       TEXT NOT NULL,
  engine        TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  fingerprint   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, engine)
);

-- ===========================================================================
-- Модуль публікації та експорту: Amazon KDP + Etsy
-- ===========================================================================

-- «Товар» — те, що автор готує до продажу: книга, курс, методика або набір.
-- Окрема сутність від книги навмисно: одна книга може дати кілька товарів
-- (сам рукопис під KDP і компактний zip-набір під Etsy), і в кожного свій
-- заголовок, ціна й теги маркетплейсу.
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL,
  book_id      TEXT,
  type         TEXT NOT NULL,                 -- book | course | methodology | bundle
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  price_usd    REAL NOT NULL DEFAULT 0,
  tags         TEXT NOT NULL DEFAULT '[]',    -- JSON-масив тегів Etsy
  components   TEXT NOT NULL DEFAULT '[]',    -- JSON: посилання на елементи бібліотеки автора
  export_files TEXT NOT NULL DEFAULT '{}',    -- JSON: { epub, pdfPrint, docx, bundleZip }
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_author ON products(author_id, updated_at DESC);

-- Публікація товару на конкретному майданчику.
-- UNIQUE(product_id, platform) — це і є ключ ідемпотентності (ТЗ 4.5):
-- повторне натискання «Опублікувати» знаходить наявний рядок і не створює
-- другий лістинг у крамниці.
CREATE TABLE IF NOT EXISTS publications (
  id             TEXT PRIMARY KEY,
  product_id     TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  platform       TEXT NOT NULL,               -- kdp | etsy
  status         TEXT NOT NULL DEFAULT 'not_started',
                                              -- not_started|files_ready|draft|published|failed
  external_id    TEXT,                        -- etsy_listing_id
  external_url   TEXT,
  last_synced_at TEXT,
  error_log      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (product_id, platform),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_publications_user ON publications(user_id, updated_at DESC);

-- Черга публікації. Живе в базі, а не в пам'яті процесу, саме тому, що ТЗ
-- (розділ 8, «Відмовостійкість») вимагає пережити рестарт сервера без втрати
-- статусу задачі. Поля step і progress — контрольні точки: після падіння на
-- завантаженні файлів задача продовжиться з файлів, а не створить новий
-- лістинг заново.
CREATE TABLE IF NOT EXISTS publication_jobs (
  id              TEXT PRIMARY KEY,
  publication_id  TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued',  -- queued|running|done|failed
  step            TEXT NOT NULL DEFAULT 'create_listing',
                             -- create_listing|upload_images|upload_files|activate|done
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT NOT NULL,
  last_error      TEXT,
  payload         TEXT NOT NULL DEFAULT '{}',
  progress        TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pub_jobs_ready ON publication_jobs(status, next_attempt_at);

-- Підключений Etsy-акаунт автора. Токени зберігаються ЗАШИФРОВАНИМИ
-- (AES-256-GCM, server/etsy/tokenCrypto.ts) — вимога ТЗ 4.2.3 і 8.
CREATE TABLE IF NOT EXISTS etsy_accounts (
  user_id           TEXT PRIMARY KEY,
  etsy_user_id      TEXT,
  shop_id           TEXT,
  shop_name         TEXT,
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  scopes            TEXT NOT NULL DEFAULT '',
  connected_at      TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- Транзитний стан OAuth-флоу: state → code_verifier (PKCE). Рядок живе
-- хвилини й видаляється одразу після обміну коду на токен.
CREATE TABLE IF NOT EXISTS etsy_oauth_states (
  state         TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- Зріз дослідження теми. Служить одразу двом цілям з ТЗ 6: кеш на 24-72 год
-- (щоб не бити в Etsy на кожен клік) і історизація (щоб показувати динаміку
-- попиту за тижні). Тому не «остання відповідь», а саме журнал зрізів.
CREATE TABLE IF NOT EXISTS etsy_research_snapshots (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  topic_key     TEXT NOT NULL,                -- нормалізована тема = ключ кешу
  topic         TEXT NOT NULL,
  taxonomy_id   INTEGER,
  collected_at  TEXT NOT NULL,
  listing_count INTEGER NOT NULL DEFAULT 0,   -- скільки лістингів реально зібрали
  total_active  INTEGER NOT NULL DEFAULT 0,   -- count з відповіді Etsy (пропозиція)
  avg_favorers  REAL NOT NULL DEFAULT 0,
  median_price  REAL NOT NULL DEFAULT 0,
  payload       TEXT NOT NULL                 -- JSON: топ-лістинги + кандидати в теги
);
CREATE INDEX IF NOT EXISTS idx_research_topic ON etsy_research_snapshots(topic_key, collected_at DESC);

-- Експрес-майстер «Книга за 5 хвилин» (Wisart Book Crealiry.md §3.4).
--
-- Чернетка живе тут, а не в пам'яті процесу: майстер проходять анонімно, а
-- реєстрацію просять аж на переході в панель створення книг — між цими
-- двома моментами користувач може перезавантажити сторінку, і втрачати
-- п'ять хвилин його роботи через це неприпустимо.
--
-- Цільова архітектура тримала б це в Redis із TTL; тут TTL емулюється полем
-- expires_at і прибиранням простроченого при старті (purgeExpiredDrafts).
CREATE TABLE IF NOT EXISTS express_drafts (
  id          TEXT PRIMARY KEY,            -- UUID; віддається клієнту й лежить у localStorage
  user_id     TEXT,                        -- NULL, поки користувач анонімний
  step        INTEGER NOT NULL DEFAULT 1,  -- Е1..Е5 — точка відновлення майстра
  payload     TEXT NOT NULL,               -- JSON: зерно, модель, прапорці, каст, синопсис
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL                -- created_at + 24 год
);
CREATE INDEX IF NOT EXISTS idx_express_drafts_user ON express_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_express_drafts_expires ON express_drafts(expires_at);

-- Діагностики /diagn (diagn-module-tech-spec-v1.0.md §7).
--
-- Звіт зберігається назавжди, а не з TTL: цінність модуля в тому, що
-- радар компетенцій можна порівняти через три місяці. Добовий TTL із ТЗ
-- стосується КЕШУ сирого результату, а не історії, — тому це окремі поля
-- cache_key + created_at, а не окрема таблиця: та сама діагностика
-- і є своїм кешем, поки їй менше доби.
CREATE TABLE IF NOT EXISTS diagnostics (
  id           TEXT PRIMARY KEY,            -- UUID, він же diagn_id у відповіді
  user_id      TEXT NOT NULL,
  book_id      TEXT,                        -- document_id у термінах ТЗ; NULL для довільного тексту
  modules      TEXT NOT NULL,               -- JSON-масив: які підмодулі виконувались
  result_json  TEXT NOT NULL,               -- JSON: нормалізовані результати підмодулів
  cache_key    TEXT NOT NULL,               -- хеш (текст + склад модулів + мова)
  word_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diagnostics_user ON diagnostics(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_diagnostics_book ON diagnostics(book_id, created_at);
CREATE INDEX IF NOT EXISTS idx_diagnostics_cache ON diagnostics(cache_key, created_at);

-- Кеш озвучених фрагментів (ElevenLabs). Один запис = один синтезований
-- mp3, знайдений/збережений за cache_key (хеш тексту+мови+голосу) —
-- server/narrationStore.ts. Без TTL: чинний, поки текст не змінився.
CREATE TABLE IF NOT EXISTS narrations (
  id              TEXT PRIMARY KEY,
  cache_key       TEXT NOT NULL,
  book_id         TEXT,
  chapter_id      TEXT,
  section_id      TEXT,
  scope           TEXT NOT NULL,             -- 'selection' | 'section'
  lang            TEXT NOT NULL,             -- 'uk' | 'en'
  voice_id        TEXT NOT NULL,
  audio_data_url  TEXT NOT NULL,             -- data:audio/mpeg;base64,... (як CourseMaterial.fileUrl)
  char_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_narrations_cache ON narrations(cache_key);
CREATE INDEX IF NOT EXISTS idx_narrations_section ON narrations(section_id, lang);
CREATE INDEX IF NOT EXISTS idx_narrations_book ON narrations(book_id, created_at);

-- ===========================================================================
-- King Market Intelligence — аналітика ринку Etsy
-- (TZ_King_Market_Intelligence_Etsy_v1_0.docx, розділи 8, 11)
-- ===========================================================================

-- Часовий ряд показників товару. Таблиця СУВОРО append-only (ТЗ 8: «кожен
-- запуск collector створює новий snapshot; попередні значення не
-- перезаписуються») — саме тому тут немає ані UNIQUE на product_key, ані
-- ON CONFLICT DO UPDATE десь у сховищі: без старих рядків не буде ані
-- Review Velocity, ані Price Change, тобто половини модуля.
--
-- Колонки source і confidence лежать у КОЖНОМУ рядку, а не в звіті над ним:
-- Etsy API в цьому середовищі не налаштований, і зріз майже завжди —
-- оцінка мовної моделі. Якщо ключ Etsy колись з'явиться, у тому самому
-- ряду теми співіснуватимуть зрізи 'ai_screen' і 'etsy_api', і відрізнити
-- їх можна буде лише порядково.
--
-- Модель ціни тут спрощена проти etsy_research_snapshots: одна валюта
-- (USD) у price_usd, бо весь модуль порівнює товари між собою, а не веде
-- бухгалтерію.
CREATE TABLE IF NOT EXISTS market_snapshots (
  id           TEXT PRIMARY KEY,
  product_key  TEXT NOT NULL,                -- <topicKey>::<externalId|slug(title)>
  topic_key    TEXT NOT NULL,                -- нормалізована тема (normalizeTopicKey)
  collected_at TEXT NOT NULL,
  price_usd    REAL,                         -- NULL = джерело не дало (ТЗ 2: не вигадуємо)
  review_count INTEGER,
  favorers     INTEGER,
  rating       REAL,
  availability TEXT,
  title        TEXT NOT NULL,
  source       TEXT NOT NULL,                -- etsy_api | ai_screen | manual | derived
  confidence   REAL NOT NULL DEFAULT 0
);
-- Два різні запити, два різні індекси: картка товару читає історію одного
-- product_key, а перерахунок звіту — усі зрізи теми за раз.
CREATE INDEX IF NOT EXISTS idx_market_snap_product ON market_snapshots(product_key, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_snap_topic   ON market_snapshots(topic_key, collected_at DESC);

-- Готовий звіт по темі. Служить кешем (щоб повторний клік не витрачав
-- виклик моделі) і водночас журналом: рядки не перезаписуються, тож видно,
-- як звіт по темі виглядав місяць тому. Денормалізовані item_count і
-- avg_opportunity винесені з payload назовні лише заради списку тем —
-- інакше кожен рядок довелося б розпарсювати, щоб показати два числа.
CREATE TABLE IF NOT EXISTS market_reports (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,                      -- NULL для планових перерахунків
  topic_key       TEXT NOT NULL,
  topic           TEXT NOT NULL,
  collected_at    TEXT NOT NULL,
  item_count      INTEGER NOT NULL DEFAULT 0,
  avg_opportunity REAL,                      -- NULL, якщо score порахувати не було з чого
  source          TEXT NOT NULL,             -- походження набору (Provenance.source)
  model_id        TEXT,                      -- яка модель робила скринінг ('ai_screen')
  payload         TEXT NOT NULL              -- JSON: MarketReport цілком
);
CREATE INDEX IF NOT EXISTS idx_market_reports_topic ON market_reports(topic_key, collected_at DESC);

-- Книга на сервері (запит власника, 03.09.2026).
--
-- ЧОМУ ЦЕ ЗʼЯВИЛОСЬ. Досі рукопис жив ЛИШЕ в IndexedDB одного браузера:
-- очищене сховище, інший комп'ютер, приватне вікно — і книги немає ніде.
-- Публікація теж ішла з браузера: клієнт надсилав весь обʼєкт книги в тілі
-- запиту, тобто сервер ніколи не мав власної копії того, що продає.
--
-- Тут лежить ДЖЕРЕЛО книги — той самий JSON, що й у браузері, без будь-якого
-- рендера. Зверстані файли (PDF, KDP, уривок, обкладинка) — не тут, а
-- файлами в DATA_DIR/books/<id>/: у базі їм робити нічого, вони великі й
-- перезбираються.
--
-- Колонка revision — охорона від затирання. Дві вкладки того самого автора
-- (або автор і співавтор) інакше перезаписували б одне одного мовчки: хто
-- зберіг останнім, той і правий, а чужі правки зникають без сліду. Запис
-- приймається, лише якщо клієнт надіслав ревізію, яку справді бачив.
CREATE TABLE IF NOT EXISTS books (
  id          TEXT PRIMARY KEY,           -- id книги зі Студії
  owner_id    TEXT,                       -- автор; NULL для книг, збережених до входу
  title       TEXT NOT NULL DEFAULT '',   -- дубль із payload, щоб перелік не читав увесь JSON
  revision    INTEGER NOT NULL DEFAULT 1, -- зростає на кожен прийнятий запис
  payload     TEXT NOT NULL,              -- JSON книги як є, без рендера
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner_id, updated_at DESC);

-- Зверстані файли книги: що саме лежить у DATA_DIR/books/<book_id>/.
--
-- Рядок тут — не сам файл, а його опис: чим зібраний, скільки сторінок,
-- коли. Без цього неможливо відповісти на просте питання «що зараз стоїть
-- у вітрині і з чого воно зроблене», а саме воно й ставиться, коли покупець
-- скаржиться на файл.
CREATE TABLE IF NOT EXISTS book_artifacts (
  id          TEXT PRIMARY KEY,           -- <book_id>:<kind>:<format>
  book_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,              -- source | pdf | sample | cover
  format      TEXT NOT NULL DEFAULT 'digital', -- digital | print
  filename    TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL DEFAULT 0,
  page_count  INTEGER,                    -- NULL для обкладинки
  variant     TEXT,                       -- code | design — чим вирішувався макет
  book_revision INTEGER NOT NULL DEFAULT 0, -- з якої ревізії книги зібрано
  built_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_book_artifacts_book ON book_artifacts(book_id, kind);

-- Задачі генерації в Gamma (запит власника, 03.09.2026).
--
-- НАВІЩО ТАБЛИЦЯ, А НЕ ПРОСТО ВИКЛИК. Дві причини, і обидві грошові.
--
-- Перша: генерація асинхронна — запит повертає id, а результат доходить за
-- 1-3 хвилини. Тримати це в памʼяті процесу означало б, що перезапуск
-- сервера губить оплачену роботу: кредити списані, а посилання немає ніде.
--
-- Друга, важливіша: КОЖНА генерація коштує кредитів рахунку власника
-- (пробний прогін: 42 кредити за дев'ять карток). Без запису, хто й на що
-- їх витратив, баланс просто зникав би, і відповісти на питання «куди
-- поділись кредити» було б нічим. Тому вартість лежить поруч із задачею,
-- як витрата моделі лежить у usage_log.
CREATE TABLE IF NOT EXISTS gamma_jobs (
  id             TEXT PRIMARY KEY,        -- generationId від Gamma
  user_id        TEXT,                    -- хто замовив
  book_id        TEXT,                    -- з якою книгою повʼязано, якщо повʼязано
  kind           TEXT NOT NULL,           -- course_deck | landing | social | document
  format         TEXT NOT NULL,           -- presentation | document | webpage | social
  status         TEXT NOT NULL,           -- pending | completed | failed
  title          TEXT NOT NULL DEFAULT '',
  gamma_url      TEXT,
  export_url     TEXT,                    -- живе близько тижня на боці Gamma
  export_as      TEXT,                    -- pdf | pptx | png | NULL
  credits_used   INTEGER,                 -- NULL, поки не завершено
  credits_left   INTEGER,                 -- баланс після списання, як його бачила Gamma
  error_uk       TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gamma_jobs_user ON gamma_jobs(user_id, created_at DESC);

`;

/**
 * `CREATE TABLE IF NOT EXISTS` не додає нові колонки в уже існуючу таблицю —
 * тож для баз, створених до появи поля `bytes` (облік МБ фотоальбому),
 * додаємо колонку вручну, якщо її ще нема.
 */
function migrateUsageLogColumns(instance: Database): void {
  try {
    const cols = instance.prepare('PRAGMA table_info(usage_log)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'bytes')) {
      instance.exec('ALTER TABLE usage_log ADD COLUMN bytes INTEGER');
    }
  } catch (err) {
    console.warn('[db] Не вдалося перевірити/додати колонку usage_log.bytes:', err);
  }
}

/**
 * Firebase Auth (docs/migration-plan.md Фаза G1) замінила власні паролі —
 * бази, створені до цього, не мають колонки firebase_uid. NULL дозволений:
 * SQLite не вважає кілька NULL порушенням UNIQUE, тож старі рядки (ще не
 * привʼязані до жодного Firebase-акаунту) співіснують з унікальним
 * індексом без конфлікту.
 */
function migrateUsersColumns(instance: Database): void {
  try {
    const cols = instance.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'firebase_uid')) {
      instance.exec('ALTER TABLE users ADD COLUMN firebase_uid TEXT');
    }
    instance.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid)');
  } catch (err) {
    console.warn('[db] Не вдалося перевірити/додати колонку users.firebase_uid:', err);
  }
}

/**
 * Відкриває базу. Виклик асинхронний, бо `node:sqlite` підвантажується
 * динамічним import: у ESM немає require, а статичний import завалив би
 * збірку на середовищах, де модуля ще немає.
 */
export async function initDb(): Promise<boolean> {
  if (available !== null) return available;

  try {
    const sqlite = (await import('node:sqlite')) as unknown as {
      DatabaseSync: new (p: string) => Database;
    };
    if (!sqlite?.DatabaseSync) throw new Error('node:sqlite не експортує DatabaseSync');

    fs.mkdirSync(DATA_DIR, { recursive: true });
    const instance = new sqlite.DatabaseSync(DB_PATH);
    instance.exec(SCHEMA);
    migrateUsageLogColumns(instance);
    migrateUsersColumns(instance);
    db = instance;
    available = true;
  } catch (err) {
    available = false;
    unavailableReason = (err as Error)?.message || String(err);
  }
  return available;
}

/** Готовий дескриптор бази. null, якщо initDb() ще не викликали або SQLite немає. */
export function getDb(): Database | null {
  return db;
}

export function isAvailable(): boolean {
  return available === true;
}

export function unavailableMessage(): string {
  return unavailableReason;
}

export function closeDb(): void {
  try {
    db?.close?.();
  } catch {
    /* ігноруємо */
  }
  db = null;
  available = null;
}

/** Лише для тестів: видаляє файл бази й скидає стан. */
export function __dropDatabaseForTests(): void {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(DB_PATH + suffix);
    } catch {
      /* файлу могло не бути */
    }
  }
}
