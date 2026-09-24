-- 0002 · Т0.4 — схема семантичного ядра (ТЗ «11 сторінок» 13.1, ТЗ-H §5).
--
-- ЗАГАЛЬНІ ПРАВИЛА, ЯКІ ТРИМАЄ САМА БАЗА (а не лише код):
--   * `project_id` у кожній таблиці, і зв'язки між записами — СКЛАДЕНИМИ
--     ключами (project_id, id): згадка, зв'язок чи версія фізично не можуть
--     послатися на сутність або абзац іншої книги, навіть якщо код помилиться.
--   * Статус усього, що міг створити AI: suggested → confirmed / rejected.
--   * Автор запису — рядок `user:<id>` / `ai:<роль>` / `system:<назва>`.
--   * AI-висновок і AI-зв'язок без доказу (id абзаців) база не прийме;
--     висновок — хіба що з явною позначкою «недостатньо даних».
--   * Кожна зміна абзацу, сутності, зв'язку чи висновку — нова версія
--     (таблиці *_versions); пише їх шар репозиторіїв у тій самій транзакції.
--
-- id абзаців, розділів і книг приходять зі Студії (Т0.5, `book.id`) і не
-- обов'язково UUID — тому `text`. Власні записи ядра — `uuid`.

-- ── Проєкт = книга (К6) ─────────────────────────────────────────────────────

CREATE TABLE projects (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL,
  title       text NOT NULL DEFAULT '',
  languages   text[] NOT NULL DEFAULT '{uk}',
  -- Лічильник ревізій книги: висновок AI пам'ятає, на якій ревізії зроблено
  -- (`analysis_findings.source_revision`, ТЗ-H §5).
  revision    integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     text NOT NULL,
  role        text NOT NULL CHECK (role IN
                ('owner', 'coauthor', 'editor', 'designer', 'publisher', 'translator', 'reader')),
  -- Обмеження ролі: глави, групи сутностей, матеріали (ТЗ 13.3). Порожньо — без обмежень.
  scopes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members (user_id);

-- ── Документи й абзаци ─────────────────────────────────────────────────────

CREATE TABLE documents (
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id          text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('chapter', 'section')),
  parent_id   text,
  ord         integer NOT NULL DEFAULT 0,
  title       text NOT NULL DEFAULT '',
  version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id)
);
CREATE INDEX documents_parent_idx ON documents (project_id, parent_id, ord);

CREATE TABLE paragraphs (
  project_id   text NOT NULL,
  id           text NOT NULL,
  document_id  text NOT NULL,
  ord          integer NOT NULL,
  kind         text NOT NULL CHECK (kind IN
                 ('paragraph', 'heading', 'blockquote', 'table', 'divider', 'image', 'draft')),
  text         text NOT NULL,
  text_hash    text NOT NULL,
  version      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Абзац, що зник із книги, не видаляється: на нього можуть посилатися
  -- висновки й історія. Він просто перестає бути частиною тексту.
  deleted_at   timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, document_id) REFERENCES documents (project_id, id) ON DELETE CASCADE
);
CREATE INDEX paragraphs_document_idx ON paragraphs (project_id, document_id, ord);

CREATE TABLE paragraph_versions (
  project_id    text NOT NULL,
  paragraph_id  text NOT NULL,
  version       integer NOT NULL,
  text          text NOT NULL,
  text_hash     text NOT NULL,
  changed_by    text NOT NULL CHECK (changed_by ~ '^(user|ai|system):.+'),
  changed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, paragraph_id, version),
  FOREIGN KEY (project_id, paragraph_id) REFERENCES paragraphs (project_id, id) ON DELETE CASCADE
);

-- ── Сутності ───────────────────────────────────────────────────────────────

CREATE TABLE entities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- slug реєстру (118 типів, src/utils/coreEntities.ts): `character`, `scene`…
  type        text NOT NULL,
  name        text NOT NULL,
  -- Затверджені поля (характеристики реєстру). AI їх не переписує (ТЗ 13.2).
  canonical   jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by  text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id)
);
CREATE INDEX entities_type_idx ON entities (project_id, type);

CREATE TABLE entity_versions (
  project_id  text NOT NULL,
  entity_id   uuid NOT NULL,
  version     integer NOT NULL,
  snapshot    jsonb NOT NULL,
  changed_by  text NOT NULL CHECK (changed_by ~ '^(user|ai|system):.+'),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  reason      text NOT NULL DEFAULT '',
  PRIMARY KEY (entity_id, version),
  FOREIGN KEY (project_id, entity_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);

-- Псевдоніми: `/character:Serhii`, `/персонаж:Сергій`, «Сергій», «Сірий» —
-- усе веде до одного UUID (ТЗ-H §5). Порівняння — за нормалізованою формою.
CREATE TABLE entity_aliases (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   text NOT NULL,
  entity_id    uuid NOT NULL,
  entity_type  text NOT NULL,
  alias        text NOT NULL,
  alias_norm   text NOT NULL,
  kind         text NOT NULL DEFAULT 'alias' CHECK (kind IN ('tag', 'name', 'alias')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, entity_type, alias_norm),
  FOREIGN KEY (project_id, entity_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);
CREATE INDEX entity_aliases_entity_idx ON entity_aliases (project_id, entity_id);

CREATE TABLE entity_mentions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         text NOT NULL,
  entity_id          uuid NOT NULL,
  paragraph_id       text NOT NULL,
  span_start         integer NOT NULL CHECK (span_start >= 0),
  span_end           integer NOT NULL,
  source             text NOT NULL CHECK (source IN ('tag', 'ai', 'author')),
  status             text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  -- «Чиє» (П1): `@Ім'я` або найближчий `/character`. Персонаж може зникнути —
  -- тоді згадка лишається, але без суб'єкта.
  subject_entity_id  uuid REFERENCES entities (id) ON DELETE SET NULL,
  -- Поля значення (П2), як їх розібрав `parseEntityValue`.
  fields             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (span_end >= span_start),
  FOREIGN KEY (project_id, entity_id) REFERENCES entities (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, paragraph_id) REFERENCES paragraphs (project_id, id) ON DELETE CASCADE
);
CREATE INDEX entity_mentions_entity_idx ON entity_mentions (project_id, entity_id);
CREATE INDEX entity_mentions_paragraph_idx ON entity_mentions (project_id, paragraph_id);

-- ── Зв'язки між сутностями (39 типів реєстру) ──────────────────────────────

CREATE TABLE entity_relations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL,
  type        text NOT NULL,
  from_id     uuid NOT NULL,
  to_id       uuid NOT NULL,
  status      text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  -- id абзаців, на яких тримається зв'язок.
  evidence    text[] NOT NULL DEFAULT '{}',
  note        text NOT NULL DEFAULT '',
  version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by  text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  CONSTRAINT entity_relations_ai_evidence CHECK (created_by NOT LIKE 'ai:%' OR cardinality(evidence) > 0),
  FOREIGN KEY (project_id, from_id) REFERENCES entities (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, to_id) REFERENCES entities (project_id, id) ON DELETE CASCADE
);
CREATE INDEX entity_relations_from_idx ON entity_relations (project_id, from_id);
CREATE INDEX entity_relations_to_idx ON entity_relations (project_id, to_id);

CREATE TABLE entity_relation_versions (
  project_id   text NOT NULL,
  relation_id  uuid NOT NULL,
  version      integer NOT NULL,
  snapshot     jsonb NOT NULL,
  changed_by   text NOT NULL CHECK (changed_by ~ '^(user|ai|system):.+'),
  changed_at   timestamptz NOT NULL DEFAULT now(),
  reason       text NOT NULL DEFAULT '',
  PRIMARY KEY (relation_id, version),
  FOREIGN KEY (project_id, relation_id) REFERENCES entity_relations (project_id, id) ON DELETE CASCADE
);

-- ── Прогони AI і висновки (три ролі AI, ТЗ 13.2; ТЗ-H §5) ─────────────────

CREATE TABLE analysis_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('AI-1', 'AI-2', 'AI-3')),
  module          text NOT NULL,
  model           text NOT NULL DEFAULT '',
  prompt_version  text NOT NULL DEFAULT '',
  -- [{ paragraphId, hash }] — щоб після правки знати, які висновки застаріли.
  inputs          jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  cost            jsonb NOT NULL DEFAULT '{}'::jsonb,
  error           text,
  created_by      text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  UNIQUE (project_id, id)
);
CREATE INDEX analysis_runs_project_idx ON analysis_runs (project_id, created_at DESC);

CREATE TABLE analysis_findings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id                uuid REFERENCES analysis_runs (id) ON DELETE SET NULL,
  entity_id             uuid REFERENCES entities (id) ON DELETE CASCADE,
  kind                  text NOT NULL,
  payload               jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_paragraph_ids  text[] NOT NULL DEFAULT '{}',
  source_revision       integer,
  -- Коли в часі історії висновок чинний: { from?, to? } (ТЗ-H §5).
  valid_story_time      jsonb,
  status                text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  -- Вхідні абзаци змінились після висновку (Т0.6 ставить, автор знімає).
  needs_review          boolean NOT NULL DEFAULT false,
  -- Висновок без доказу можливий лише з цією позначкою (ТЗ 13.2).
  insufficient_data     boolean NOT NULL DEFAULT false,
  -- project — усім учасникам за правами; author — лише автору;
  -- hidden — таємниця: не йде в пошук, індекси й журнали (ТЗ-H §5.1).
  visibility            text NOT NULL DEFAULT 'project' CHECK (visibility IN ('project', 'author', 'hidden')),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by            text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  CONSTRAINT analysis_findings_ai_evidence
    CHECK (created_by NOT LIKE 'ai:%' OR cardinality(source_paragraph_ids) > 0 OR insufficient_data)
);
CREATE INDEX analysis_findings_entity_idx ON analysis_findings (project_id, entity_id);
CREATE INDEX analysis_findings_sources_idx ON analysis_findings USING gin (source_paragraph_ids);

CREATE TABLE analysis_finding_versions (
  project_id  text NOT NULL,
  finding_id  uuid NOT NULL,
  version     integer NOT NULL,
  snapshot    jsonb NOT NULL,
  changed_by  text NOT NULL CHECK (changed_by ~ '^(user|ai|system):.+'),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  reason      text NOT NULL DEFAULT '',
  PRIMARY KEY (finding_id, version),
  FOREIGN KEY (project_id, finding_id) REFERENCES analysis_findings (project_id, id) ON DELETE CASCADE
);
