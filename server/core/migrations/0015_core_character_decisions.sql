-- 0015 · Т2.5 В2 — журнал рішень героя (ТЗ Harness + Jev §10
-- `character_decisions`; PLAN_JEV_LEVELS.md §2, рішення власника §6 п.2).

-- Кожне рішення Jev-рівня (FLC 2.0 §3: стратегічний / сценічний /
-- тактичний) зберігається з відбитком знімка, версією моделі й підставами
-- (ТЗ-H §6.3, FLC 2.0 §3 «Усі рішення зберігати з snapshot_hash, версією
-- моделі й підставами»). Цей самий запис — кеш рівня: `cache_key` —
-- відбиток того, від чого рівень залежить (значущі події, умови сцени…),
-- і доки ключ той самий, рішення використовується повторно (В3).
-- `status`: active — чинне; superseded — замінене новішим того ж рівня;
-- awaiting_author — ні Jev, ні запасний LLM не дали прийнятного рішення,
-- вибирає автор (рішення власника §6 п.4; `selected_action` тоді порожнє).
-- `basis` — лише посилання (id абзаців і сутностей), а не знімок: приватне
-- в журнал не дублюється (ТЗ-H §10, §13).
CREATE TABLE character_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id     uuid NOT NULL,
  level            text NOT NULL CHECK (level IN ('strategic', 'scene', 'tactical')),
  scene_id         text,
  simulation_id    text,
  turn_index       integer CHECK (turn_index IS NULL OR turn_index >= 0),
  cache_key        text NOT NULL CHECK (length(cache_key) BETWEEN 1 AND 200),
  parent_id        uuid REFERENCES character_decisions(id) ON DELETE SET NULL,
  questions        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(questions) = 'array'),
  options          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(options) = 'object'),
  result           jsonb,
  selected_action  text CHECK (selected_action IS NULL OR length(selected_action) BETWEEN 1 AND 60),
  validation       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation) = 'object'),
  snapshot_hash    text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{16,64}$'),
  model_version    text NOT NULL CHECK (length(model_version) BETWEEN 1 AND 120),
  source           text NOT NULL CHECK (source IN ('jev', 'mock', 'llm_fallback', 'author')),
  fallback_reason  text CHECK (fallback_reason IS NULL OR length(fallback_reason) <= 1000),
  basis            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(basis) = 'object'),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'awaiting_author')),
  usage            jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms       integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  created_by       text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_by      text CHECK (resolved_by IS NULL OR resolved_by ~ '^user:.+'),
  resolved_at      timestamptz,
  CHECK (status = 'awaiting_author' OR selected_action IS NOT NULL),
  CHECK (source <> 'author' OR resolved_by IS NOT NULL),
  FOREIGN KEY (project_id, character_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);
CREATE INDEX character_decisions_cache_idx ON character_decisions (project_id, character_id, level, cache_key) WHERE status = 'active';
CREATE INDEX character_decisions_character_idx ON character_decisions (project_id, character_id, created_at DESC);
CREATE INDEX character_decisions_simulation_idx ON character_decisions (project_id, simulation_id) WHERE simulation_id IS NOT NULL;
