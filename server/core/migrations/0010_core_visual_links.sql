-- 0010 · Т2.3 В2 — прив'язка зображень Медіатеки до сутностей книги
-- (PLAN_VISUAL_LIBRARY.md §2, §3 В2).

-- Зображення живе в Медіатеці Студії (SQLite, `media_assets`); тут — лише
-- зв'язок «зображення ↔ сутність або сцена» в межах книги (проєкту ядра):
--   role       — portrait / full_body / reference / depicts / location /
--                object (ціль — сутність) або scene (ціль — розділ книги);
--   target     — 'e:<entity_id>' або 's:<section_id>', ключ унікальності;
--   source     — author (прив'язав автор), ai (пропозиція AI-3, етап В4),
--                legacy (перенесено з книги: портрет героя, ілюстрація
--                розділу — синхронізація ядра веде їх сама);
--   status     — пропозиція / підтверджено / відхилено (відхилене лишається,
--                щоб перенесення з книги не повертало його знову);
--   needs_review, checked_hash — для етапу В5 («перевірити» після зміни опису).
CREATE TABLE asset_entity_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  asset_url     text NOT NULL CHECK (length(asset_url) BETWEEN 1 AND 2000 AND asset_url !~* '^data:'),
  asset_id      text,
  entity_id     uuid,
  section_id    text,
  target        text NOT NULL,
  role          text NOT NULL CHECK (role IN ('portrait', 'full_body', 'reference', 'depicts', 'location', 'object', 'scene')),
  status        text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  source        text NOT NULL DEFAULT 'author' CHECK (source IN ('author', 'ai', 'legacy')),
  needs_review  boolean NOT NULL DEFAULT false,
  checked_hash  text,
  evidence      text[] NOT NULL DEFAULT '{}',
  note          text NOT NULL DEFAULT '',
  created_by    text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, asset_url, target, role),
  CHECK ((entity_id IS NOT NULL) <> (section_id IS NOT NULL)),
  CHECK ((role = 'scene') = (section_id IS NOT NULL)),
  CHECK (target = CASE WHEN entity_id IS NOT NULL THEN 'e:' || entity_id::text ELSE 's:' || section_id END),
  CHECK (source <> 'ai' OR status <> 'confirmed' OR created_by !~ '^ai:'),
  FOREIGN KEY (project_id, entity_id) REFERENCES entities (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, section_id) REFERENCES documents (project_id, id) ON DELETE CASCADE
);
CREATE INDEX asset_entity_links_entity_idx ON asset_entity_links (project_id, entity_id);
CREATE INDEX asset_entity_links_section_idx ON asset_entity_links (project_id, section_id);
CREATE INDEX asset_entity_links_asset_idx ON asset_entity_links (project_id, asset_url);
