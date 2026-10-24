/**
 * Схема гаманця AI-балів (ТЗ v0.5, §2.5). Окремий файл без імпортів, щоб
 * db.ts міг підставити її у SCHEMA, а тести — створити таблиці в памʼяті.
 *
 * credit_ledger — незмінний журнал: рядки лише додаються. credit_accounts —
 * похідний знімок, що оновлюється В ТІЙ САМІЙ транзакції, що й проводка.
 */
export const CREDIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS credit_accounts (
  user_id    TEXT PRIMARY KEY,
  available  INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved   INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  -- grant | reserve | charge | release | adjustment | expire
  kind            TEXT NOT NULL,
  -- зміна доступних балів (знакова) і зарезервованих
  available_delta INTEGER NOT NULL,
  reserved_delta  INTEGER NOT NULL,
  ref             TEXT,
  idempotency_key TEXT,
  reason          TEXT,
  operator        TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_idem ON credit_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS credit_reservations (
  job_key    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  -- reserved | charged | released
  status     TEXT NOT NULL,
  charged    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_reservations_user ON credit_reservations(user_id, status);
`;
