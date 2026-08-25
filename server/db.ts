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
  avatar_url    TEXT,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

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
