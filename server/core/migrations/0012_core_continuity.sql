-- 0012 · Т2.4 В1 — таблиці безперервності: риси сутностей і проблеми
-- (PLAN_CONTINUITY.md §2, §3 В1).

-- Риса сутності — пара «мітка → значення» (вік, колір, розмір…), яку
-- вписує автор (картка сутності) чи пропонує AI-2 (В6, `suggested`, автор
-- підтверджує). Кілька рис з однаковою міткою на тій самій сутності —
-- матеріал для правила `trait_contradiction` (В3): різне значення без
-- `supersedes` (автор явно позначив «це заміна, не суперечність») — і є
-- проблема. Вік героя (правило «вік») — це риса з міткою «вік»; версії
-- зовнішності (Т2.3 В3, `appearance_versions.age`) живлять її автоматично
-- при синхронізації (В3), не дублюючи дані.
CREATE TABLE entity_traits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_id      uuid NOT NULL,
  label          text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  value          text NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 400),
  section_id     text,
  story_time_key double precision,
  status         text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  source         text NOT NULL DEFAULT 'author' CHECK (source IN ('author', 'ai')),
  supersedes     uuid REFERENCES entity_traits(id) ON DELETE SET NULL,
  created_by     text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (created_by !~ '^ai:' OR status = 'suggested'),
  FOREIGN KEY (project_id, entity_id) REFERENCES entities (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, section_id) REFERENCES documents (project_id, id) ON DELETE CASCADE
);
CREATE INDEX entity_traits_entity_idx ON entity_traits (project_id, entity_id, label);

-- Проблема безперервності — суперечність між двома конкретними місцями
-- тексту (докази A/Б), знайдена правилом (kind: time/age/place/object/
-- knowledge, В2–В5) чи AI-2-проходом по розділах (В6, source: 'ai'). П'ять
-- статусів, не статус+прапорець (задача прямо каже «п'ять»):
-- suggested → confirmed / dismissed → resolved (автор виправив текст,
-- лишається в історії) і needs_review (текст доказу змінився після
-- останньої перевірки — `checked_hash`, за зразком
-- `asset_entity_links.checked_hash`, В6). Доказ Б відсутній лише коли
-- `insufficient_data` (AI-2 не набрало пари) — те саме правило ядра, що й
-- висновки AI-3 (`rules.ts: checkNewFinding`, `evidence_required`).
CREATE TABLE continuity_issues (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('object', 'knowledge', 'place', 'age', 'time')),
  entity_id          uuid,
  summary            text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 500),
  evidence_a         jsonb NOT NULL,
  evidence_b         jsonb,
  status             text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'dismissed', 'resolved', 'needs_review')),
  source             text NOT NULL DEFAULT 'rule' CHECK (source IN ('rule', 'ai')),
  checked_hash       text,
  insufficient_data  boolean NOT NULL DEFAULT false,
  created_by         text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (insufficient_data OR evidence_b IS NOT NULL),
  CHECK (created_by !~ '^ai:' OR status = 'suggested'),
  FOREIGN KEY (project_id, entity_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);
CREATE INDEX continuity_issues_entity_idx ON continuity_issues (project_id, entity_id);
CREATE INDEX continuity_issues_kind_idx ON continuity_issues (project_id, kind, status);
