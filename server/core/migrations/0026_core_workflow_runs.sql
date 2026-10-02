-- 0026 · Т5.4 В1 — виконання процесів ШІ: запуски, трасування вузлів і
-- контрольні точки LangGraph (PLAN_WORKFLOW_ENGINE.md; ТЗ Graph Studio §27,
-- §30, §31, §39 №8, 24). Виконується опублікована версія; запуск пам'ятає
-- саме її (id, номер, хеш визначення) і свій вхід — повтор і відгалуження
-- йдуть на тих самих версіях.

CREATE TABLE workflow_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id        text NOT NULL REFERENCES workflows (id),
  version_id         uuid NOT NULL REFERENCES workflow_versions (id),
  version            integer NOT NULL CHECK (version >= 1),
  definition_hash    text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  -- Книга чи курс, над якими йде процес (ручний запуск без проєкту — null).
  project_id         text CHECK (project_id IS NULL OR length(project_id) BETWEEN 1 AND 200),
  status             text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'succeeded', 'failed', 'cancelled')),
  -- normal — перший запуск; replay — той самий вхід і версія; fork — від контрольної точки іншого запуску.
  mode               text NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal', 'replay', 'fork')),
  parent_run_id      uuid REFERENCES workflow_runs (id) ON DELETE SET NULL,
  fork_step          integer CHECK (fork_step IS NULL OR fork_step >= 1),
  -- Звідки запуск: задача черги, допит, ручний із Graph Studio.
  trigger            text NOT NULL CHECK (trigger ~ '^(job:[a-z_]{1,40}|interview|manual|replay|fork)$'),
  job_id             uuid,
  input              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input) = 'object'),
  input_hash         text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  output             jsonb CHECK (output IS NULL OR jsonb_typeof(output) = 'object'),
  current_node       text CHECK (current_node IS NULL OR length(current_node) <= 64),
  pause_requested    boolean NOT NULL DEFAULT false,
  error              text CHECK (error IS NULL OR length(error) <= 4000),
  tokens_in          integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out         integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_usd           numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  latency_ms         integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  started_by         text NOT NULL CHECK (started_by ~ '^(user|system|ai):.+'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  CHECK (status IN ('running', 'paused') OR finished_at IS NOT NULL)
);
CREATE INDEX workflow_runs_workflow_idx ON workflow_runs (workflow_id, created_at DESC);
CREATE INDEX workflow_runs_project_idx ON workflow_runs (project_id, created_at DESC);
CREATE INDEX workflow_runs_status_idx ON workflow_runs (status, created_at DESC);

-- Крок запуску (§27): одна спроба вузла — один рядок.
CREATE TABLE workflow_run_steps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id             uuid NOT NULL REFERENCES workflow_runs (id) ON DELETE CASCADE,
  seq                integer NOT NULL CHECK (seq >= 1),
  node_id            text NOT NULL CHECK (length(node_id) BETWEEN 1 AND 64),
  node_type          text NOT NULL CHECK (node_type ~ '^[A-Z][A-Z_]{1,39}$'),
  status             text NOT NULL CHECK (status IN ('succeeded', 'failed', 'paused')),
  retry_count        integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  branch             text CHECK (branch IS NULL OR length(branch) <= 64),
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz NOT NULL,
  latency_ms         integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  model              text,
  tokens_in          integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out         integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_usd           numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  decision           text CHECK (decision IS NULL OR length(decision) <= 400),
  confidence         real CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  validation_result  text CHECK (validation_result IS NULL OR length(validation_result) <= 400),
  human_result       text CHECK (human_result IS NULL OR length(human_result) <= 400),
  error              text CHECK (error IS NULL OR length(error) <= 4000),
  warnings           text[] NOT NULL DEFAULT '{}',
  details            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  UNIQUE (run_id, seq)
);

-- Контрольні точки LangGraph (§31): стан після кожного вузла — для паузи,
-- продовження й відгалуження. Один рядок на запуск (серіалізований потік).
CREATE TABLE workflow_checkpoints (
  run_id             uuid PRIMARY KEY REFERENCES workflow_runs (id) ON DELETE CASCADE,
  data               jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
