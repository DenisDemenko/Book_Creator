-- 0014 · Т2.4 В7 — перевірки чернеток на «витік знання» (ТЗ-H)
-- (PLAN_CONTINUITY.md §2 «Чернетка-симуляція», §3 В7, §6 п.4).

-- Той самий перевіряльник, що й правило «знання» (В4), але над текстом, якого
-- в книзі ще немає: чернетка сцени чи репліка симуляції. Знахідки — не факти
-- книги, тому НЕ пишуться в `continuity_issues`; рішення власника — історію
-- перевірок зберігати. Окрема таблиця без зв'язку з рештою ядра, крім героя.
-- `section_id` — сцена, станом на початок якої рахувалось знання (немає —
-- кінець книги); без зовнішнього ключа: розділ можна видалити, а історія
-- перевірки лишається такою, якою була. `simulation_id` — порожнє, доки немає
-- Т2.7 («Допит живого персонажа»); тоді перевірка під час симуляції
-- прив'яжеться до неї цим полем, без зміни таблиці.
CREATE TABLE continuity_draft_checks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  character_id   uuid NOT NULL,
  section_id     text,
  draft_text     text NOT NULL CHECK (length(btrim(draft_text)) >= 1 AND length(draft_text) <= 20000),
  findings       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array'),
  simulation_id  text CHECK (simulation_id IS NULL OR length(btrim(simulation_id)) BETWEEN 1 AND 200),
  created_by     text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, character_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);
CREATE INDEX continuity_draft_checks_character_idx ON continuity_draft_checks (project_id, character_id, created_at DESC);
CREATE INDEX continuity_draft_checks_simulation_idx ON continuity_draft_checks (project_id, simulation_id) WHERE simulation_id IS NOT NULL;
