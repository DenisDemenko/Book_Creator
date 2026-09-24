-- 0003 · Т0.7 — фонова черга задач ядра (ТЗ-11 13.5 «асинхронність»,
-- ТЗ-H §11 «бюджети»). Зразок — черга публікації Etsy
-- (server/etsy/publishQueue.ts): стан у базі, повтори, відновлення після
-- перезапуску. Відмінності:
--   * кілька інстансів Студії можуть брати задачі одночасно — захоплення
--     через FOR UPDATE SKIP LOCKED, а «завислу» задачу (процес помер) видно
--     за застарілим heartbeat_at, а не за самим фактом перезапуску;
--   * скасування — прапорець, який задача бачить на найближчій контрольній точці;
--   * ключ ідемпотентності: той самий ключ — та сама задача, а не друга;
--   * бюджет токенів і запитів на проєкт (і згодом на симуляцію).

CREATE TABLE core_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Вид задачі: `core_sync`, `ai_analysis`… Воркер бере лише ті види, які знає.
  kind               text NOT NULL,
  status             text NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { done, total, step, note } — що бачить автор («синхронізація… 3 з 12»);
  -- і водночас місце, звідки задача продовжить після перезапуску.
  progress           jsonb NOT NULL DEFAULT '{}'::jsonb,
  result             jsonb,
  error              text,
  idempotency_key    text,
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts       integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  next_attempt_at    timestamptz NOT NULL DEFAULT now(),
  cancel_requested   boolean NOT NULL DEFAULT false,
  locked_by          text,
  heartbeat_at       timestamptz,
  -- Бюджет: з якого кошика списувати, скільки задача обіцяла й скільки витратила.
  budget_scope       text NOT NULL DEFAULT 'project',
  estimated_tokens   integer NOT NULL DEFAULT 0 CHECK (estimated_tokens >= 0),
  used_tokens        integer NOT NULL DEFAULT 0 CHECK (used_tokens >= 0),
  used_requests      integer NOT NULL DEFAULT 0 CHECK (used_requests >= 0),
  created_by         text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  UNIQUE (project_id, id)
);

-- Той самий ключ у межах проєкту й виду — одна задача (повторне натискання,
-- повторне збереження тієї самої ревізії).
CREATE UNIQUE INDEX core_jobs_idempotency_uidx
  ON core_jobs (project_id, kind, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- Що брати далі.
CREATE INDEX core_jobs_queued_idx ON core_jobs (next_attempt_at) WHERE status = 'queued';
CREATE INDEX core_jobs_running_idx ON core_jobs (heartbeat_at) WHERE status = 'running';
-- Список задач проєкту й ліміт частоти (скільки поставлено за останню хвилину).
CREATE INDEX core_jobs_project_idx ON core_jobs (project_id, kind, created_at DESC);

-- Бюджет на проєкт: `scope` = 'project' або 'simulation:<id>' (ТЗ-H, Н5).
-- NULL у ліміті — без обмеження. Період: day / month (календарні, UTC) або total.
CREATE TABLE core_budgets (
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope           text NOT NULL DEFAULT 'project',
  period          text NOT NULL DEFAULT 'month' CHECK (period IN ('day', 'month', 'total')),
  limit_tokens    bigint CHECK (limit_tokens IS NULL OR limit_tokens >= 0),
  limit_requests  integer CHECK (limit_requests IS NULL OR limit_requests >= 0),
  used_tokens     bigint NOT NULL DEFAULT 0 CHECK (used_tokens >= 0),
  used_requests   integer NOT NULL DEFAULT 0 CHECK (used_requests >= 0),
  window_start    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, scope)
);
