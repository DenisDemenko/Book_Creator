-- 0017 · Т2.7 В1 — «Допит живого персонажа» (FLC етап 1): AI-персонаж,
-- дослідницькі прогони, їхні ходи й пропозиції в канон (ТЗ Harness + Jev §10
-- `character_agents`, `scene_simulations`, `simulation_events`,
-- `canon_proposals`; FLC 2.0 §7; PLAN_INTERVIEW.md §2, рішення власника §6).

-- Перемикач «AI-персонаж» і рівень автономності (рішення власника §6 п.3):
-- off — вимкнено; interview — відповідає на допиті; scene — учасник сцени
-- (чекає Magic Scene, Т3). Увімкнено ⇔ рівень не off.
CREATE TABLE character_agents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id    uuid NOT NULL,
  enabled         boolean NOT NULL DEFAULT false,
  autonomy_level  text NOT NULL DEFAULT 'off' CHECK (autonomy_level IN ('off', 'interview', 'scene')),
  agent_config    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(agent_config) = 'object'),
  model_policy    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(model_policy) = 'object'),
  created_by      text NOT NULL CHECK (created_by ~ '^(user|system):.+'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL CHECK (updated_by ~ '^(user|system):.+'),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (enabled = (autonomy_level <> 'off')),
  UNIQUE (project_id, character_id),
  FOREIGN KEY (project_id, character_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);

-- Дослідницький прогін (не канон): допит одного героя (interview) чи, далі,
-- сцена (scene, Т3). base_book_revision — ревізія книги на старті: змінилась
-- сцена прогону — прогін «застарів» (stale, В4).
CREATE TABLE scene_simulations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('interview', 'scene')),
  character_id        uuid,
  scene_id            text CHECK (scene_id IS NULL OR length(scene_id) BETWEEN 1 AND 200),
  as_of_chapter       integer CHECK (as_of_chapter IS NULL OR as_of_chapter >= 1),
  base_book_revision  integer NOT NULL CHECK (base_book_revision >= 0),
  title               text NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  config              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed', 'stale')),
  current_turn        integer NOT NULL DEFAULT 0 CHECK (current_turn >= 0),
  created_by          text NOT NULL CHECK (created_by ~ '^(user|system):.+'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'interview' OR character_id IS NOT NULL),
  FOREIGN KEY (project_id, character_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);
CREATE INDEX scene_simulations_character_idx ON scene_simulations (project_id, character_id, created_at DESC);

-- Ходи прогону: питання автора, відповідь героя, «чекає автора» (рішення не
-- прийнято), «не вдалося» (модель недоступна — питання збережене). Лише
-- те, що можна показати (public_payload); приватне — посиланням.
CREATE TABLE simulation_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  simulation_id        uuid NOT NULL REFERENCES scene_simulations(id) ON DELETE CASCADE,
  turn_index           integer NOT NULL CHECK (turn_index >= 0),
  actor                text NOT NULL CHECK (actor IN ('author', 'character', 'system')),
  actor_character_id   uuid,
  event_type           text NOT NULL CHECK (event_type IN ('question', 'answer', 'awaiting', 'failed', 'note')),
  public_payload       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(public_payload) = 'object'),
  private_payload_ref  text CHECK (private_payload_ref IS NULL OR length(private_payload_ref) <= 200),
  source_decision_id   uuid REFERENCES character_decisions(id) ON DELETE SET NULL,
  created_by           text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (actor <> 'character' OR actor_character_id IS NOT NULL),
  CHECK (event_type <> 'question' OR actor = 'author')
);
CREATE INDEX simulation_events_turn_idx ON simulation_events (simulation_id, turn_index, created_at);

-- Що автор може прийняти з прогону (рішення власника §6 п.2): спогад героя,
-- факт профілю (гіпотеза з допиту), чистий фрагмент для книги, тег до
-- фрагмента (П7 — пропозицією, з фрагментом чи окремо). Лише автор вирішує.
CREATE TABLE canon_proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  simulation_id     uuid NOT NULL REFERENCES scene_simulations(id) ON DELETE CASCADE,
  character_id      uuid NOT NULL,
  source_event_ids  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_event_ids) = 'array'),
  kind              text NOT NULL CHECK (kind IN ('memory', 'fact', 'fragment', 'tag')),
  proposed_change   jsonb NOT NULL CHECK (jsonb_typeof(proposed_change) = 'object'),
  parent_id         uuid REFERENCES canon_proposals(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  result            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  created_by        text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_by       text CHECK (reviewed_by IS NULL OR reviewed_by ~ '^user:.+'),
  reviewed_at       timestamptz,
  CHECK (status = 'pending' OR reviewed_by IS NOT NULL),
  CHECK (kind <> 'tag' OR parent_id IS NOT NULL),
  FOREIGN KEY (project_id, character_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);
CREATE INDEX canon_proposals_simulation_idx ON canon_proposals (simulation_id, created_at);
CREATE INDEX canon_proposals_pending_idx ON canon_proposals (project_id, character_id) WHERE status = 'pending';
