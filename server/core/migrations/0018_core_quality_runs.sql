-- 0018 · Т2.8 В3 — прогони набору якості «живих персонажів» (PLAN_QUALITY.md;
-- FLC 2.0, етап 2). Рівень платформи, а не книги: набір самодостатній (власна
-- тестова книга), прогін іде в окремому сховищі в пам'яті, і в ядро книг не
-- пише нічого — лише цей журнал прогонів зі звітом.

CREATE TABLE quality_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id        text NOT NULL CHECK (length(set_id) BETWEEN 1 AND 100),
  set_version   integer NOT NULL CHECK (set_version >= 1),
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  label         text NOT NULL DEFAULT '' CHECK (length(label) <= 300),
  -- Ворота пройдено (null — прогін ще не завершено).
  passed        boolean,
  -- Виміри й ворота кожного режиму без ходів (для переліку й порівняння).
  summary       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  -- Повний звіт із ходами (без запитів до моделі — лише відповіді й оцінки).
  report        jsonb CHECK (report IS NULL OR jsonb_typeof(report) = 'object'),
  -- Моделі прогону: голос, рішення, суддя (версії — для порівняння прогонів).
  models        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(models) = 'object'),
  cost_usd      numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  budget_usd    numeric(12, 6) CHECK (budget_usd IS NULL OR budget_usd > 0),
  error         text CHECK (error IS NULL OR length(error) <= 2000),
  created_by    text NOT NULL CHECK (created_by ~ '^(user|system):.+'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  CHECK (status NOT IN ('succeeded', 'failed') OR finished_at IS NOT NULL)
);
CREATE INDEX quality_runs_created_idx ON quality_runs (set_id, created_at DESC);
