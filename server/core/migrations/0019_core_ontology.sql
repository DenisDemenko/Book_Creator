-- 0019 · Т5.1 В2 — реєстр схем: версії онтології (PLAN_ONTOLOGY.md; ТЗ Graph
-- Studio v3.0 §4.4–4.5, §34, §37). Одна онтологія на платформу (рішення
-- власника): Fusion Story Ontology. Версія — один JSON-документ
-- `fusion-ontology/1`; опублікована версія незмінна, нова зміна — нова версія.

CREATE TABLE ontology_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ontology_id      text NOT NULL CHECK (length(ontology_id) BETWEEN 1 AND 100),
  -- Порядковий номер версії в межах онтології: 1, 2, 3… (ontology_version, ТЗ §34).
  version          integer NOT NULL CHECK (version >= 1),
  label            text NOT NULL DEFAULT '' CHECK (length(label) <= 100),
  -- draft → validated → active → deprecated → archived; відкинута чернетка — archived.
  status           text NOT NULL CHECK (status IN ('draft', 'validated', 'active', 'deprecated', 'archived')),
  based_on         uuid REFERENCES ontology_versions (id),
  definition       jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  definition_hash  text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  -- Остання перевірка (VALIDATE) і вплив на дані (MIGRATION IMPACT) — для того самого хешу.
  validation       jsonb CHECK (validation IS NULL OR jsonb_typeof(validation) = 'object'),
  impact           jsonb CHECK (impact IS NULL OR jsonb_typeof(impact) = 'object'),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  -- Лічильник правок — захист від одночасних змін чернетки.
  revision         integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by       text NOT NULL CHECK (created_by ~ '^(user|system):.+'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  published_by     text CHECK (published_by IS NULL OR published_by ~ '^(user|system):.+'),
  published_at     timestamptz,
  UNIQUE (ontology_id, version),
  CHECK (status NOT IN ('active', 'deprecated') OR published_at IS NOT NULL),
  CHECK (status NOT IN ('draft', 'validated') OR published_at IS NULL)
);
-- Рівно одна активна версія й щонайбільше одна відкрита чернетка на онтологію.
CREATE UNIQUE INDEX ontology_versions_one_active ON ontology_versions (ontology_id) WHERE status = 'active';
CREATE UNIQUE INDEX ontology_versions_one_draft ON ontology_versions (ontology_id) WHERE status IN ('draft', 'validated');

-- Опублікована версія незмінна: її визначення (і хеш) не правиться навіть SQL-ем.
CREATE FUNCTION ontology_versions_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.published_at IS NOT NULL AND (NEW.definition IS DISTINCT FROM OLD.definition OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash) THEN
    RAISE EXCEPTION 'Опублікована версія онтології незмінна (%)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'Час публікації версії онтології не змінюється (%)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ontology_versions_frozen BEFORE UPDATE ON ontology_versions FOR EACH ROW EXECUTE FUNCTION ontology_versions_frozen();

-- Журнал аудиту реєстру схем (ТЗ §37): лише дописується.
CREATE TABLE ontology_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ontology_id  text NOT NULL CHECK (length(ontology_id) BETWEEN 1 AND 100),
  version_id   uuid REFERENCES ontology_versions (id),
  action       text NOT NULL CHECK (action IN ('import', 'create_draft', 'edit', 'validate', 'impact', 'publish', 'rollback', 'archive', 'discard')),
  actor        text NOT NULL CHECK (actor ~ '^(user|system):.+'),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ontology_events_idx ON ontology_events (ontology_id, created_at DESC);
