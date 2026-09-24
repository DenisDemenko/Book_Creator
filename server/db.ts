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

import { CORE_ENTITIES, CORE_ENTITY_RELATIONS } from '../src/utils/coreEntities';

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

-- ЖУРНАЛ ДОКАЗІВ РОЗВИТКУ ПИСЬМЕННИКА (WDI, запис #156).
--
-- Тільки дописується й ніколи не переписується: бали навичок ЩОРАЗУ
-- згортаються з цього журналу ("server/wdi.ts"), а не зберігаються
-- окремим змінним полем. Тому будь-яке число WDI можна показати разом
-- із подіями, які його дали, — автор бачить підставу, а не вердикт.
--
-- UNIQUE(user_id, source_id) — це ідемпотентність на рівні БАЗИ, а не
-- коду. Без неї повторний аналіз того самого тексту накручував би бал;
-- у макеті це намагався стримати масив "seenTextHashes" у localStorage,
-- але він губився разом із браузером.
CREATE TABLE IF NOT EXISTS writer_evidence (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  book_id       TEXT,
  skill         TEXT NOT NULL,
  type          TEXT NOT NULL,
  outcome       REAL NOT NULL,
  confidence    REAL NOT NULL,
  independence  INTEGER NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  source_id     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE(user_id, source_id)
);

-- Читаємо майже завжди "усі докази одного автора", інколи з відбором за
-- навичкою — саме під це індекс.
CREATE INDEX IF NOT EXISTS idx_writer_evidence_user
  ON writer_evidence(user_id, skill);

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

-- Медіатека автора на сервері (задача #100).
--
-- ЧОМУ. Досі зображення жили у двох однаково ненадійних місцях: завантажені
-- з компʼютера — як data:-URL всередині книги в IndexedDB одного браузера,
-- згенеровані ШІ — файлами в assets/generated поруч із кодом. Перше
-- означало, що кожне збереження книги тягне через мережу мегабайти base64
-- (див. mirrorBookToServer), а очищене сховище браузера стирає альбом.
-- Друге — що на хостингу з ефемерним диском усі згенеровані картинки
-- зникають при наступному деплої, і жоден рядок бази про це не знає.
--
-- Тут — ОПИС файлу, самі байти лежать у DATA_DIR/media/<user>/ (як і
-- зверстані книги: великі двійкові дані в базі не тримаємо).
--
-- Поля prompt і model обовʼязково поруч: без них вдале зображення неможливо
-- ні повторити, ні пояснити, і воно перетворюється на випадкову картинку.
CREATE TABLE IF NOT EXISTS media_assets (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,           -- чиє. Чуже віддаємо як 404, а не 403
  book_id     TEXT,                    -- з якою книгою повʼязано, якщо повʼязано
  kind        TEXT NOT NULL,           -- upload | illustration | character_art | cover_art
  filename    TEXT NOT NULL,           -- як назвав автор; на диску інше, безпечне імʼя
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  prompt      TEXT,                    -- NULL лише для завантажених з компʼютера
  model       TEXT,                    -- те саме
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_assets_owner ON media_assets(owner_id, created_at DESC);

-- Зовнішній API для застосунків автора (WriterScan — фото сторінки з телефону).
--
-- Токен — особистий і довгоживучий, як Personal Access Token: автор створює
-- його в Студії й вставляє в застосунок. У базі лише SHA-256 хеш: сам токен
-- показується один раз і більше ніде не зберігається, тож витік бази не
-- видає робочих токенів. prefix — перші символи для впізнавання в списку.
CREATE TABLE IF NOT EXISTS external_api_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  prefix        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_external_api_tokens_user ON external_api_tokens(user_id, created_at DESC);

-- Скани сторінок із зовнішнього застосунку. Скан НЕ пише в книгу сам: книга
-- живе в браузері автора (IndexedDB), а серверна копія — лише дзеркало, яке
-- наступне збереження з браузера перезаписало б. Тому скан лягає у «Вхідні»
-- медіатеки, і вже автор у Студії вставляє його в главу AI-чернеткою.
CREATE TABLE IF NOT EXISTS external_scans (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL,
  book_id          TEXT NOT NULL,
  asset_id         TEXT NOT NULL,
  image_url        TEXT NOT NULL,
  status           TEXT NOT NULL,       -- processing | recognized | failed | submitted | inserted | dismissed
  recognized_text  TEXT NOT NULL DEFAULT '',
  text             TEXT NOT NULL DEFAULT '',
  chapter_id       TEXT,
  chapter_title    TEXT,
  section_title    TEXT,
  model_id         TEXT,
  error            TEXT,
  token_id         TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_external_scans_owner ON external_scans(owner_id, status, created_at DESC);

-- РЎР°РјРѕСЃС‚С–Р№РЅС– РЅР°РІС‡Р°Р»СЊРЅС– РєСѓСЂСЃРё (docs/tech-spec-course-wizard-2026.md).
-- РљСѓСЂСЃ РЅРµ РїСЂРёРІРјСЏР·Р°РЅРёР№ РґРѕ РєРЅРёРіРё: СЂРµРјС–СЃРЅРёС‡С– РєСѓСЂСЃРё Р±СѓРІР°СЋС‚СЊ Р±РµР· СЂСѓРєРѕРїРёСЃСѓ.
-- Р’РµСЃСЊ РІРјС–СЃС‚ (РјРѕРґСѓР»С–, СѓСЂРѕРєРё, Р·Р°РІРґР°РЅРЅСЏ, РЅР°РІРёС‡РєРё) — JSON Сѓ payload.
CREATE TABLE IF NOT EXISTS courses (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,                    -- Р°РІС‚РѕСЂ (user id)
  status       TEXT NOT NULL DEFAULT 'draft',    -- draft | ready | published
  title        TEXT NOT NULL DEFAULT '',         -- РґСѓР±Р»СЊ С–Р· payload РґР»СЏ СЃРїРёСЃРєС–РІ
  payload      TEXT NOT NULL,                    -- JSON РєСѓСЂСЃСѓ
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_courses_owner ON courses(owner_id, updated_at DESC);

-- Черга модерації публікацій у вітрину. Автор подає готовий твір
-- (книгу/курс/інструкцію/гру), адміністратор погоджує або відхиляє —
-- і лише після погодження твір стає товаром у маркетплейсі.
CREATE TABLE IF NOT EXISTS moderation (
  id           TEXT PRIMARY KEY,
  item_type    TEXT NOT NULL,                   -- book | course | instruction | game
  item_id      TEXT NOT NULL,                   -- id у Студії (book.id / course.id)
  title        TEXT NOT NULL,
  author_id    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reason       TEXT,
  created_at   TEXT NOT NULL,
  decided_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_moderation_status ON moderation(status, created_at);

-- Чат підтримки сайту (адмін-CRM, log.md — розділ «CRM/чат підтримки»).
-- Один тред на користувача (лише зареєстровані — анонімним гостям чат
-- недоступний, тож user_id NOT NULL UNIQUE достатньо, окремий thread_id
-- у клієнта не потрібен). Двостороннє листування: sender_role розрізняє
-- репліку користувача від відповіді адміністратора, а unread_by_admin /
-- unread_by_user — прості лічильники непрочитаного з обох боків, щоб не
-- рахувати їх агрегатом по support_messages на кожен показ списку в CRM.
CREATE TABLE IF NOT EXISTS support_threads (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL DEFAULT 'open',  -- open | closed
  last_message_at       TEXT NOT NULL,
  last_message_preview  TEXT NOT NULL DEFAULT '',
  message_count         INTEGER NOT NULL DEFAULT 0,
  unread_by_admin       INTEGER NOT NULL DEFAULT 0,
  unread_by_user        INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_threads_updated ON support_threads(updated_at DESC);

-- attachments: JSON-масив id файлів медіатеки, доданих до повідомлення
-- (фото або знімок екрана). Самі байти лежать у медіасховищі
-- (server/media/mediaLibraryStore.ts), а не в базі — тут лише посилання.
-- Для баз, створених до появи вкладень, колонку додає
-- migrateSupportMessageColumns() нижче.
CREATE TABLE IF NOT EXISTS support_messages (
  id            TEXT PRIMARY KEY,
  thread_id     TEXT NOT NULL,
  sender_role   TEXT NOT NULL,             -- user | admin
  sender_id     TEXT NOT NULL,
  content       TEXT NOT NULL,
  attachments   TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES support_threads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, created_at);

-- ===========================================================================
-- «Емоційна майстерність письменника» + «Поріг» — два AI-модулі тренажерів
-- (ARCHITECTURE_EMOTION_THRESHOLD_MODULES.md). Обидва дописують у вже наявну
-- writer_evidence вище (skill: emotion_reader_impact | character_craft) —
-- це не паралельна система прогресу, а нові постачальники доказів у ту саму
-- WDI. Поле «project_id» з ТЗ тут немає (Nova не має сутності «проєкт»): скопована
-- та сама пара user_id + опційний book_id, що й у решти аналітичних таблиць.
-- Scene не є SQL-рядком (живе всередині JSON книги), тому scene_id усюди
-- нижче — м'яке посилання, БЕЗ FOREIGN KEY, той самий тип звʼязку, що й
-- book_id у chat_sessions.
-- ===========================================================================

-- Розширюваний словник емоцій (п. 3 ТЗ «Емоційна майстерність»). Насіння —
-- 9 категорій таксономії власника, завантажене одноразово seedEmotionDictionary()
-- нижче; is_custom дозволяє додавати нові пізніше (адмінський екран — поза
-- межами цього етапу).
CREATE TABLE IF NOT EXISTS emotion_dictionary (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL,
  label_uk    TEXT NOT NULL,
  is_custom   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- Один аналізований фрагмент. UNIQUE(user_id, selected_text_hash) — той
-- самий принцип ідемпотентності, що й у writer_evidence: повторний аналіз
-- НЕЗМІНЕНОГО фрагмента не плодить нові рядки й не накручує WDI-докази.
-- mastery_score/mastery_level НЕ приходять від AI — їх рахує
-- server/emotionMasteryScoring.ts із сирих балів mastery_scores нижче.
CREATE TABLE IF NOT EXISTS emotion_analysis (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  book_id             TEXT,
  scene_id            TEXT,
  character_id        TEXT,
  character_name      TEXT NOT NULL,
  selected_text       TEXT NOT NULL,
  selected_text_hash  TEXT NOT NULL,
  primary_emotion_id  TEXT NOT NULL,
  primary_probability REAL NOT NULL,
  primary_intensity   REAL NOT NULL,
  mastery_score       REAL NOT NULL,
  threshold_impact    REAL NOT NULL,
  confidence          REAL NOT NULL,
  model_version       TEXT NOT NULL,
  prompt_version      TEXT NOT NULL,
  rubric_version      TEXT NOT NULL,
  taxonomy_version    TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  UNIQUE(user_id, selected_text_hash)
);
CREATE INDEX IF NOT EXISTS idx_emotion_analysis_user ON emotion_analysis(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emotion_analysis_book ON emotion_analysis(book_id);

-- Вторинні й приховані емоції одного аналізу.
CREATE TABLE IF NOT EXISTS emotion_candidates (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,   -- secondary | hidden
  emotion_id   TEXT NOT NULL,
  probability  REAL NOT NULL,
  intensity    REAL NOT NULL,
  FOREIGN KEY (analysis_id) REFERENCES emotion_analysis(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_emotion_candidates_analysis ON emotion_candidates(analysis_id);

-- 10 критеріїв майстерності (п. 6 ТЗ), по одному рядку кожен — сирі бали
-- 0..10 від AI, затиснуті server/emotionMasteryScoring.ts::validateMasteryScores.
CREATE TABLE IF NOT EXISTS emotion_mastery_scores (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL,
  criterion    TEXT NOT NULL,
  score        REAL NOT NULL,
  FOREIGN KEY (analysis_id) REFERENCES emotion_analysis(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_emotion_mastery_scores_analysis ON emotion_mastery_scores(analysis_id);

-- Докази під кожен критерій (п. 10 ТЗ: жоден бал без цитати й пояснення).
CREATE TABLE IF NOT EXISTS emotion_evidence (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL,
  criterion    TEXT NOT NULL,
  quote        TEXT NOT NULL,
  explanation  TEXT NOT NULL,
  FOREIGN KEY (analysis_id) REFERENCES emotion_analysis(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_emotion_evidence_analysis ON emotion_evidence(analysis_id);

-- Емоційна крива для довгих виділень (п. 13 ТЗ). Порожня для коротких
-- фрагментів без розвитку емоції — це нормально, не помилка.
CREATE TABLE IF NOT EXISTS emotion_timeline (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL,
  order_index  INTEGER NOT NULL,
  emotion_id   TEXT NOT NULL,
  intensity    REAL NOT NULL,
  FOREIGN KEY (analysis_id) REFERENCES emotion_analysis(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_emotion_timeline_analysis ON emotion_timeline(analysis_id, order_index);

-- «Профіль емоцій автора» (п. 18 ТЗ) свідомо НЕ окрема таблиця — рахується
-- на льоту з emotion_analysis/emotion_mastery_scores
-- (server/emotionMasteryStore.ts::projectAuthorEmotionProfile), той самий
-- принцип, що й проєкції WDI-балів у server/wdi.ts: журнал — джерело
-- правди, підсумок — завжди похідний.

-- Кандидат у поріг, підтверджений автором (ARCHITECTURE_EMOTION_THRESHOLD_
-- MODULES.md, розділ 6.3: AI лише ПРОПОНУЄ, сюди пишеться тільки те, що
-- автор зберіг/відредагував). risk_* — профіль ризику інлайн-колонками, не
-- окремою таблицею (див. розділ 8, відкрите питання плану): фіксований
-- 5-осьовий профіль завжди читається разом із рештою порогу, окрема таблиця
-- дала б лише зайвий JOIN на кожен показ. score рахує сервер при кожному
-- save (server/thresholdScoring.ts::thresholdScore) і зберігає для
-- сортування/фільтра — на відміну від WDI-балів це НЕ агрегована проєкція
-- журналу, а детермінована функція власних полів одного рядка, тож
-- зберігати її тут безпечно.
CREATE TABLE IF NOT EXISTS thresholds (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  book_id           TEXT,
  character_id      TEXT,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  types             TEXT NOT NULL DEFAULT '[]',
  before_state      TEXT NOT NULL,
  choice            TEXT NOT NULL,
  crossing_action   TEXT NOT NULL,
  after_state       TEXT NOT NULL,
  risk_physical     INTEGER NOT NULL DEFAULT 1,
  risk_emotional    INTEGER NOT NULL DEFAULT 1,
  risk_social       INTEGER NOT NULL DEFAULT 1,
  risk_material     INTEGER NOT NULL DEFAULT 1,
  risk_existential  INTEGER NOT NULL DEFAULT 1,
  cost              INTEGER NOT NULL DEFAULT 1,
  irreversibility   INTEGER NOT NULL DEFAULT 1,
  transformation    INTEGER NOT NULL DEFAULT 1,
  awareness         INTEGER NOT NULL DEFAULT 5,
  agency            INTEGER NOT NULL DEFAULT 5,
  score             REAL NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'planned',
  consequences      TEXT NOT NULL DEFAULT '[]',
  confidence        REAL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thresholds_user ON thresholds(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_thresholds_book ON thresholds(book_id);

-- Звʼязок порогу зі сценами (preparation/crossing/consequence, п. 9 ТЗ) —
-- на відміну від risk_*, це СПРАВЖНЯ many-to-many колекція змінного
-- розміру, тож окрема таблиця тут виправдана без застережень.
CREATE TABLE IF NOT EXISTS threshold_scene_links (
  id            TEXT PRIMARY KEY,
  threshold_id  TEXT NOT NULL,
  scene_id      TEXT NOT NULL,
  role          TEXT NOT NULL,   -- preparation | crossing | consequence
  order_index   INTEGER NOT NULL,
  FOREIGN KEY (threshold_id) REFERENCES thresholds(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_threshold_scene_links_threshold ON threshold_scene_links(threshold_id);

-- Уникнений поріг (п. 2.2 ТЗ «Поріг») — окрема сутність від thresholds:
-- описує НЕ перехід, а відмову/відкладення його, тож поля зовсім інші
-- (страх, поведінка уникнення, короткострокова винагорода і довгострокова
-- ціна), не варіант того самого запису з іншим статусом.
CREATE TABLE IF NOT EXISTS avoided_thresholds (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL,
  book_id                TEXT,
  character_id           TEXT,
  development_area       TEXT NOT NULL,
  threshold_description  TEXT NOT NULL,
  fear                   TEXT NOT NULL,
  avoidance_behavior     TEXT NOT NULL,
  short_term_reward      TEXT NOT NULL,
  long_term_cost         TEXT NOT NULL,
  repetitions            INTEGER NOT NULL DEFAULT 1,
  severity               INTEGER NOT NULL DEFAULT 5,
  next_opportunity       TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_avoided_thresholds_user ON avoided_thresholds(user_id, updated_at DESC);

-- ===========================================================================
-- ЯДРО СУТНОСТЕЙ (реєстр власника, 118 типів + 37 типів зв'язків)
--
-- НАВІЩО В БАЗІ, ЯКЩО Є КОД. Сам перелік справді живе в коді
-- (src/utils/coreEntities.ts) — там він читається клієнтом, панеллю,
-- чатом і тестами без жодного запиту. Але «сутності ядра» — це ще й
-- словник, на який посилаються ДАНІ: теги абзаців у книзі, згадки в
-- чаті (chat_message_entities нижче), майбутні правила сортування.
-- Посилатися на словник, який існує лише в коді, означає, що зміна
-- коду тихо міняє зміст уже збережених даних. Таблиця дає точку, від
-- якої можна перевірити цілісність (скільки рядків, які кольори, чи є
-- тег у тексті книги сутністю реєстру), і саме це робить насіння нижче.
--
-- group_id — «A»…«I» базового реєстру та «J1»…«J3» додатка «Літературна
-- критика»; registry розрізняє походження запису, бо документ описує
-- додаток окремо (88 + 30 = 118) і змішувати їх в одному переліку не можна.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS core_entities (
  slug            TEXT PRIMARY KEY,       -- ключ без слеша: character
  tag             TEXT NOT NULL,          -- тег як у документі: /character
  name_uk         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  group_id        TEXT NOT NULL,
  color           TEXT NOT NULL,          -- HEX із документа, як є
  characteristics TEXT NOT NULL,          -- JSON-масив назв характеристик
  registry        TEXT NOT NULL,          -- base | critic
  sort_order      INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_core_entities_group ON core_entities(group_id, sort_order);

CREATE TABLE IF NOT EXISTS core_entity_relations (
  key         TEXT PRIMARY KEY,           -- participates_in
  name_uk     TEXT NOT NULL,
  example     TEXT NOT NULL,
  registry    TEXT NOT NULL,              -- base | critic
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);

-- Сутності, якими автор помітив повідомлення в чаті ШІ (постановка, п. 7).
--
-- НАВІЩО ОКРЕМА ТАБЛИЦЯ, А НЕ ПОЛЕ В chat_messages. Групування в чаті —
-- це запит «покажи всі розмови, де згадано /threshold», тобто вибірка ПО
-- СУТНОСТІ, а не читання одного повідомлення. Зберігати це рядком у
-- content означало б або парсити кожен рядок на кожен запит, або тримати
-- другу копію того самого тексту. Тут — індекс, і саме тому він будується
-- НА ЗАПИСІ повідомлення, а не «коли знадобиться».
--
-- text_value — те, що автор написав після двокрапки («Serhii», «страх»).
-- Без нього групування по сутності втратило б конкретику: «у цій розмові
-- згадано /character» і «згадано Сергія» — різні за цінністю відповіді.
CREATE TABLE IF NOT EXISTS chat_message_entities (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  slug        TEXT NOT NULL,
  text_value  TEXT NOT NULL DEFAULT '',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_message_entities_message ON chat_message_entities(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_entities_session ON chat_message_entities(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_entities_slug ON chat_message_entities(user_id, slug);

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
 * Вкладення в чаті підтримки з'явилися пізніше за саму таблицю, тож у
 * базах, створених до них, колонки ще немає — `CREATE TABLE IF NOT
 * EXISTS` її не дописує. Значення за замовчуванням «[]» робить старі
 * рядки коректними без окремого переливання даних.
 */
function migrateSupportMessageColumns(instance: Database): void {
  try {
    const cols = instance.prepare('PRAGMA table_info(support_messages)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'attachments')) {
      instance.exec("ALTER TABLE support_messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'");
    }
  } catch (err) {
    console.warn('[db] Не вдалося перевірити/додати колонку support_messages.attachments:', err);
  }
}

/**
 * Насіння словника емоцій (п. 3 ТЗ «Емоційна майстерність») — 9 категорій
 * таксономії власника, ~48 записів. Вставляється лише якщо таблиця
 * порожня (не INSERT OR IGNORE по одному: так один запуск точно знає, чи
 * це перший старт, а не тихо змагається з паралельною міграцією).
 *
 * «Цікавість» у ТЗ власника згадана у ДВОХ категорій (future і
 * orientation) — оскільки `id` тут PRIMARY KEY, дублікат неможливий:
 * лишаємо її під `future` (де вона зустрічається першою), `orientation`
 * без неї має 3 записи замість 4. Емоції з однаковим українським словом,
 * але різним змістом (напр. «захоплення» — і в joy як delight, і в social
 * як admiration) — це НЕ колізія: англомовні машинні коди різні.
 */
const EMOTION_DICTIONARY_SEED: { id: string; category: string; labelUk: string }[] = [
  { id: 'fear', category: 'fear', labelUk: 'страх' },
  { id: 'anxiety', category: 'fear', labelUk: 'тривога' },
  { id: 'terror', category: 'fear', labelUk: 'жах' },
  { id: 'worry', category: 'fear', labelUk: 'занепокоєння' },
  { id: 'insecurity', category: 'fear', labelUk: 'невпевненість' },
  { id: 'helplessness', category: 'fear', labelUk: 'безпорадність' },

  { id: 'anger', category: 'anger', labelUk: 'гнів' },
  { id: 'irritation', category: 'anger', labelUk: 'роздратування' },
  { id: 'rage', category: 'anger', labelUk: 'лють' },
  { id: 'indignation', category: 'anger', labelUk: 'обурення' },
  { id: 'hostility', category: 'anger', labelUk: 'ворожість' },
  { id: 'resentment', category: 'anger', labelUk: 'образа' },

  { id: 'sadness', category: 'loss', labelUk: 'сум' },
  { id: 'grief', category: 'loss', labelUk: 'горе' },
  { id: 'longing', category: 'loss', labelUk: 'туга' },
  { id: 'loneliness', category: 'loss', labelUk: 'самотність' },
  { id: 'disappointment', category: 'loss', labelUk: 'розчарування' },
  { id: 'despair', category: 'loss', labelUk: 'відчай' },

  { id: 'joy', category: 'joy', labelUk: 'радість' },
  { id: 'satisfaction', category: 'joy', labelUk: 'задоволення' },
  { id: 'delight', category: 'joy', labelUk: 'захоплення' },
  { id: 'relief', category: 'joy', labelUk: 'полегшення' },
  { id: 'gratitude', category: 'joy', labelUk: 'вдячність' },
  { id: 'inspiration', category: 'joy', labelUk: 'натхнення' },

  { id: 'love', category: 'attachment', labelUk: 'любов' },
  { id: 'tenderness', category: 'attachment', labelUk: 'ніжність' },
  { id: 'affection', category: 'attachment', labelUk: 'прихильність' },
  { id: 'trust', category: 'attachment', labelUk: 'довіра' },
  { id: 'compassion', category: 'attachment', labelUk: 'співчуття' },
  { id: 'care', category: 'attachment', labelUk: 'турбота' },

  { id: 'shame', category: 'self_evaluative', labelUk: 'сором' },
  { id: 'guilt', category: 'self_evaluative', labelUk: 'провина' },
  { id: 'pride', category: 'self_evaluative', labelUk: 'гордість' },
  { id: 'embarrassment', category: 'self_evaluative', labelUk: 'збентеження' },
  { id: 'humiliation', category: 'self_evaluative', labelUk: 'приниження' },

  { id: 'hope', category: 'future', labelUk: 'надія' },
  { id: 'anticipation', category: 'future', labelUk: 'передчуття' },
  { id: 'curiosity', category: 'future', labelUk: 'цікавість' },
  { id: 'impatience', category: 'future', labelUk: 'нетерпіння' },
  { id: 'hopelessness', category: 'future', labelUk: 'безнадія' },

  { id: 'envy', category: 'social', labelUk: 'заздрість' },
  { id: 'jealousy', category: 'social', labelUk: 'ревнощі' },
  { id: 'admiration', category: 'social', labelUk: 'захоплення' },
  { id: 'contempt', category: 'social', labelUk: 'презирство' },
  { id: 'disgust', category: 'social', labelUk: 'відраза' },

  { id: 'surprise', category: 'orientation', labelUk: 'здивування' },
  { id: 'confusion', category: 'orientation', labelUk: 'розгубленість' },
  { id: 'astonishment', category: 'orientation', labelUk: 'подив' },
];

function seedEmotionDictionary(instance: Database): void {
  try {
    const row = instance.prepare('SELECT COUNT(*) AS n FROM emotion_dictionary').get() as { n: number } | undefined;
    if ((row?.n ?? 0) > 0) return;
    const insert = instance.prepare(
      'INSERT INTO emotion_dictionary (id, category, label_uk, is_custom, created_at) VALUES (?, ?, ?, 0, ?)'
    );
    const now = new Date().toISOString();
    for (const e of EMOTION_DICTIONARY_SEED) {
      insert.run(e.id, e.category, e.labelUk, now);
    }
  } catch (err) {
    console.warn('[db] Не вдалося засіяти emotion_dictionary:', err);
  }
}

/**
 * Насіння реєстру сутностей ядра — 118 типів і 37 зв'язків із документа
 * власника (див. `src/utils/coreEntities.ts`).
 *
 * НЕ «ЛИШЕ ЯКЩО ПОРОЖНЬО», на відміну від словника емоцій вище. Словник
 * емоцій — це дані власника, які він може дописувати (є `is_custom`), тож
 * повторне насіння затерло б його правки. Реєстр сутностей — навпаки,
 * похідна від коду: якщо рядок у документі перейменовано (або виправлено
 * HEX), база мусить це побачити на наступному старті, а не жити зі старою
 * копією, доки хтось не здогадається видалити файл бази. Тому тут upsert
 * по кожному рядку плюс прибирання тих, яких у коді вже немає.
 *
 * 118 INSERT-ів на старті — це мікросекунди; натомість розходження між
 * кодом і базою, яке ніхто не помічає, коштує дорого: саме воно робить
 * «сутність у панелі» й «сутність у книзі» різними речами.
 */
function seedCoreEntityRegistry(instance: Database): void {
  try {
    const now = new Date().toISOString();

    const upsertEntity = instance.prepare(
      `INSERT INTO core_entities (slug, tag, name_uk, name_en, group_id, color, characteristics, registry, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET
         tag = excluded.tag, name_uk = excluded.name_uk, name_en = excluded.name_en,
         group_id = excluded.group_id, color = excluded.color,
         characteristics = excluded.characteristics, registry = excluded.registry,
         sort_order = excluded.sort_order, updated_at = excluded.updated_at`
    );
    CORE_ENTITIES.forEach((entity, index) => {
      upsertEntity.run(
        entity.slug,
        entity.tag,
        entity.nameUk,
        entity.nameEn,
        entity.groupId,
        entity.color,
        JSON.stringify(entity.characteristics),
        entity.registry,
        index,
        now
      );
    });

    // Прибираємо те, чого в коді вже немає — інакше видалена з документа
    // сутність лишалася б у базі назавжди й «оживала» б у запитах.
    const entitySlugs = CORE_ENTITIES.map((e) => e.slug);
    instance
      .prepare(`DELETE FROM core_entities WHERE slug NOT IN (${entitySlugs.map(() => '?').join(',')})`)
      .run(...entitySlugs);

    const upsertRelation = instance.prepare(
      `INSERT INTO core_entity_relations (key, name_uk, example, registry, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         name_uk = excluded.name_uk, example = excluded.example,
         registry = excluded.registry, sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`
    );
    CORE_ENTITY_RELATIONS.forEach((relation, index) => {
      upsertRelation.run(relation.key, relation.nameUk, relation.example, relation.registry, index, now);
    });

    const relationKeys = CORE_ENTITY_RELATIONS.map((r) => r.key);
    instance
      .prepare(`DELETE FROM core_entity_relations WHERE key NOT IN (${relationKeys.map(() => '?').join(',')})`)
      .run(...relationKeys);
  } catch (err) {
    console.warn('[db] Не вдалося засіяти реєстр сутностей ядра:', err);
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
    migrateSupportMessageColumns(instance);
    seedEmotionDictionary(instance);
    seedCoreEntityRegistry(instance);
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
