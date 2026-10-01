-- 0022 · Т5.2 В2 — процеси ШІ (AI Workflow Graph) з версіями й середовищами
-- (PLAN_GRAPH_STUDIO.md; ТЗ Graph Studio v3.0 §5, §34, §37, §38, №7, 27, 28).
-- Визначення — один JSON-документ `fusion-workflow/1`. Середовища:
-- draft → test → production → archived; правка чернетки не змінює робочого,
-- заморожена (тестова чи опублікована) версія незмінна. Розкладка канви —
-- окремо (`graph_layouts`), семантики не змінює.

CREATE TABLE workflows (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]{1,63}$'),
  name         jsonb NOT NULL CHECK (jsonb_typeof(name) = 'object'),
  description  text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by   text NOT NULL CHECK (created_by ~ '^(user|system):.+'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workflow_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      text NOT NULL REFERENCES workflows (id),
  -- workflow_version (ТЗ §34): 1, 2, 3… у межах процесу.
  version          integer NOT NULL CHECK (version >= 1),
  environment      text NOT NULL CHECK (environment IN ('draft', 'test', 'production', 'archived')),
  based_on         uuid REFERENCES workflow_versions (id),
  definition       jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  definition_hash  text NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  validation       jsonb CHECK (validation IS NULL OR jsonb_typeof(validation) = 'object'),
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  revision         integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by       text NOT NULL CHECK (created_by ~ '^(user|system):.+'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  tested_by        text CHECK (tested_by IS NULL OR tested_by ~ '^(user|system):.+'),
  tested_at        timestamptz,
  published_by     text CHECK (published_by IS NULL OR published_by ~ '^(user|system):.+'),
  published_at     timestamptz,
  UNIQUE (workflow_id, version),
  CHECK (environment <> 'draft' OR (tested_at IS NULL AND published_at IS NULL)),
  CHECK (environment <> 'test' OR tested_at IS NOT NULL),
  CHECK (environment <> 'production' OR published_at IS NOT NULL),
  CHECK (published_at IS NULL OR tested_at IS NOT NULL)
);
-- Щонайбільше одна чернетка, одна тестова й одна робоча версія на процес.
CREATE UNIQUE INDEX workflow_versions_one_draft ON workflow_versions (workflow_id) WHERE environment = 'draft';
CREATE UNIQUE INDEX workflow_versions_one_test ON workflow_versions (workflow_id) WHERE environment = 'test';
CREATE UNIQUE INDEX workflow_versions_one_production ON workflow_versions (workflow_id) WHERE environment = 'production';

-- Заморожена версія (тест або вище) незмінна навіть SQL-ем; середовище йде лише вперед.
CREATE FUNCTION workflow_versions_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.tested_at IS NOT NULL AND (NEW.definition IS DISTINCT FROM OLD.definition OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash) THEN
    RAISE EXCEPTION 'Заморожена версія процесу незмінна (%)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.environment = 'archived' AND NEW.environment <> 'archived' THEN
    RAISE EXCEPTION 'Архівна версія процесу не повертається (%)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.environment <> 'draft' AND NEW.environment = 'draft' THEN
    RAISE EXCEPTION 'Версія процесу не повертається в чернетку (%)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER workflow_versions_frozen BEFORE UPDATE ON workflow_versions FOR EACH ROW EXECUTE FUNCTION workflow_versions_frozen();

-- Журнал аудиту процесів (ТЗ §37): лише дописується.
CREATE TABLE workflow_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  text NOT NULL REFERENCES workflows (id),
  version_id   uuid REFERENCES workflow_versions (id),
  action       text NOT NULL CHECK (action IN ('create', 'create_draft', 'edit', 'validate', 'to_test', 'publish', 'rollback', 'archive', 'discard', 'rename')),
  actor        text NOT NULL CHECK (actor ~ '^(user|system):.+'),
  details      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_events_workflow_idx ON workflow_events (workflow_id, created_at DESC);

-- Розкладка канви (№28): координати вузлів окремо від визначення. Для процесу —
-- на версію; для онтології — спільна (`version_ref` = '*').
CREATE TABLE graph_layouts (
  graph_kind   text NOT NULL CHECK (graph_kind IN ('workflow', 'ontology')),
  graph_id     text NOT NULL CHECK (length(graph_id) BETWEEN 1 AND 100),
  version_ref  text NOT NULL CHECK (length(version_ref) BETWEEN 1 AND 64),
  layout       jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
  updated_by   text NOT NULL CHECK (updated_by ~ '^(user|system):.+'),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (graph_kind, graph_id, version_ref)
);
