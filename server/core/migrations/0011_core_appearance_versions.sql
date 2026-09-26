-- 0011 · Т2.3 В3 — версії зовнішності героя за віком чи етапом
-- (PLAN_VISUAL_LIBRARY.md §2, §3 В3).

-- Версія зовнішності — етап життя героя з власним описом і портретом:
-- «Олена, 8 років · гл. 2–3», «30 років · з гл. 4». Глави дії — від/до
-- (порожнє — «з початку» / «до кінця»). Профіль у режимі «стан на главі N» і
-- «Хто в сцені» показують портрет версії, що діє в главі N.
--   description_hash — відбиток затвердженого опису (етап В5: зміна опису →
--                      «перевірити» ілюстрації, звірені зі старим);
--   approved         — опис затверджено автором; діють лише затверджені.
-- Основа — картка героя в Студії (канон автора): її опис пропонується першій
-- версії, а сама картка лишається «версією без глав».
CREATE TABLE appearance_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL,
  label            text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  age              text NOT NULL DEFAULT '' CHECK (length(age) <= 40),
  from_chapter     integer CHECK (from_chapter >= 1),
  to_chapter       integer CHECK (to_chapter >= 1),
  description      text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  description_hash text NOT NULL,
  approved         boolean NOT NULL DEFAULT true,
  created_by       text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (from_chapter IS NULL OR to_chapter IS NULL OR to_chapter >= from_chapter),
  CHECK (created_by !~ '^ai:' OR NOT approved),
  FOREIGN KEY (project_id, entity_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);
CREATE INDEX appearance_versions_entity_idx ON appearance_versions (project_id, entity_id);

-- Історія версій: знімок після кожної зміни (і останній — при видаленні),
-- як `entity_versions` для сутностей.
CREATE TABLE appearance_version_history (
  id          bigserial PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_id  uuid NOT NULL,
  entity_id   uuid NOT NULL,
  action      text NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'portrait', 'portrait_removed')),
  snapshot    jsonb NOT NULL,
  actor       text NOT NULL CHECK (actor ~ '^(user|ai|system):.+'),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appearance_version_history_entity_idx ON appearance_version_history (project_id, entity_id, at);

-- Портрет версії — звичайний зв'язок «портрет» (повний зріст, референс) з
-- позначкою версії: одне джерело правди для Медіатеки, профілю й сцени.
-- Версію видалено — зв'язок лишається загальним портретом героя.
ALTER TABLE asset_entity_links
  ADD COLUMN appearance_version_id uuid REFERENCES appearance_versions(id) ON DELETE SET NULL,
  ADD CONSTRAINT asset_entity_links_version_role
    CHECK (appearance_version_id IS NULL OR (entity_id IS NOT NULL AND role IN ('portrait', 'full_body', 'reference')));
