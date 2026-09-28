-- 0016 · Т2.6 В1 — довготривала суб'єктивна пам'ять героя (ТЗ Harness +
-- Jev §5.1, §10 `character_memories`, `character_states`; FLC 2.0 §2, §4;
-- PLAN_CHARACTER_MEMORY.md §2, рішення власника §6).

-- Пам'ять героя — п'ять видів (FLC 2.0 §2): світовий факт, знання героя,
-- переконання (зокрема хибне), суб'єктивний спогад, наслідок. Шари
-- world_truth / character_belief / reader_knowledge — окремо (ТЗ-H §5.1):
-- переконання, спогад і наслідок — завжди character_belief (переконання
-- ніколи не записується як world_truth, FLC 2.0 §4); reader_knowledge у
-- знімок героя не йде ніколи.
-- Кожен запис — рівно одне з simulation_id (спогад прогону, Т2.7) і
-- canon_revision (спогад канону з ревізією книги): незатверджене одного
-- прогону не бачить інший.
-- evidence_hash — відбиток тексту абзаців-доказів на момент запису: після
-- правки сцени залежні спогади стають needs_review (В3).
CREATE TABLE character_memories (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id         uuid NOT NULL,
  memory_type          text NOT NULL CHECK (memory_type IN ('world_fact', 'knowledge', 'belief', 'recollection', 'consequence')),
  layer                text NOT NULL CHECK (layer IN ('world_truth', 'character_belief', 'reader_knowledge')),
  content              text NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  about_entity_ids     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(about_entity_ids) = 'array'),
  effects              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(effects) = 'object'),
  belief_status        text NOT NULL DEFAULT 'knows' CHECK (belief_status IN ('knows', 'believes', 'doubts', 'abandoned')),
  truth                text NOT NULL DEFAULT 'unknown' CHECK (truth IN ('true', 'false', 'unknown')),
  source_event_kind    text NOT NULL CHECK (source_event_kind IN ('entity', 'paragraph', 'decision', 'simulation_event', 'author')),
  source_event_id      text CHECK (source_event_id IS NULL OR length(source_event_id) BETWEEN 1 AND 200),
  source_paragraph_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_paragraph_ids) = 'array'),
  evidence_hash        text CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[0-9a-f]{16,64}$'),
  scene_id             text CHECK (scene_id IS NULL OR length(scene_id) BETWEEN 1 AND 200),
  story_time           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(story_time) = 'object'),
  simulation_id        text CHECK (simulation_id IS NULL OR length(simulation_id) BETWEEN 1 AND 100),
  canon_revision       integer CHECK (canon_revision IS NULL OR canon_revision >= 0),
  visibility           text NOT NULL DEFAULT 'project' CHECK (visibility IN ('project', 'author', 'hidden')),
  origin               text NOT NULL CHECK (origin IN ('tag', 'ai', 'author', 'simulation')),
  status               text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('suggested', 'confirmed', 'needs_review', 'rejected', 'superseded')),
  dedupe_key           text CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 1 AND 200),
  review_note          text CHECK (review_note IS NULL OR length(review_note) <= 500),
  created_by           text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  reviewed_by          text CHECK (reviewed_by IS NULL OR reviewed_by ~ '^(user|system):.+'),
  reviewed_at          timestamptz,
  -- Рівно одне: спогад прогону або спогад канону.
  CHECK ((simulation_id IS NULL) <> (canon_revision IS NULL)),
  -- Шар за видом: суб'єктивне — лише character_belief; знання — world_truth.
  CHECK (memory_type NOT IN ('belief', 'recollection', 'consequence') OR layer = 'character_belief'),
  CHECK (memory_type <> 'knowledge' OR layer = 'world_truth'),
  CHECK (memory_type <> 'world_fact' OR layer IN ('world_truth', 'reader_knowledge')),
  -- AI лише пропонує (підтверджує автор — reviewed_by).
  CHECK (origin <> 'ai' OR status <> 'confirmed' OR reviewed_by IS NOT NULL),
  -- Прогін пише лише свої спогади.
  CHECK (origin <> 'simulation' OR simulation_id IS NOT NULL),
  FOREIGN KEY (project_id, character_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);
CREATE INDEX character_memories_character_idx ON character_memories (project_id, character_id, status);
CREATE INDEX character_memories_simulation_idx ON character_memories (project_id, simulation_id) WHERE simulation_id IS NOT NULL;
CREATE INDEX character_memories_paragraphs_idx ON character_memories USING gin (source_paragraph_ids);
-- Повторний збір із тегів не дублює: один ключ — один живий запис героя.
CREATE UNIQUE INDEX character_memories_dedupe_idx ON character_memories (project_id, character_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status NOT IN ('rejected', 'superseded');

-- Стан героя на сцену (ТЗ-H §10): кеш CharacterSnapshotBuilder (В5) —
-- цілі, емоції, переконання, стосунки, версія стану, відбиток знімка і
-- які спогади взято. Прогін — окремий стан (simulation_id), канон — ні.
CREATE TABLE character_states (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id     uuid NOT NULL,
  scene_id         text CHECK (scene_id IS NULL OR length(scene_id) BETWEEN 1 AND 200),
  simulation_id    text CHECK (simulation_id IS NULL OR length(simulation_id) BETWEEN 1 AND 100),
  canon_revision   integer NOT NULL CHECK (canon_revision >= 0),
  goals            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(goals) = 'array'),
  emotions         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(emotions) = 'array'),
  beliefs          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(beliefs) = 'array'),
  relationships    jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(relationships) = 'array'),
  memory_ids       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(memory_ids) = 'array'),
  state_version    integer NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  snapshot_hash    text NOT NULL CHECK (snapshot_hash ~ '^[0-9a-f]{16,64}$'),
  created_by       text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, character_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);
CREATE INDEX character_states_lookup_idx ON character_states (project_id, character_id, scene_id, simulation_id, canon_revision, created_at DESC);
