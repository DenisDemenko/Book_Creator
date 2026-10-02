-- 0023 · Т5.3 В1 — реєстр пропозицій до канону (PLAN_STORY_CORE.md;
-- ТЗ Graph Studio v3.0 §24 стани, §25 походження, §39 №14–16).
-- Пропозиція сутності чи зв'язку проходить стани detected → proposed →
-- validated → approved → canon (або rejected / superseded). AI лише пропонує
-- й лише з доказом; стан змінює людина чи система; кінцеві стани незмінні.
-- Канон — це справжні entities / entity_relations: пропозиція лише посилається
-- на запис (`canon_ref`), копії канону тут немає (§23).

CREATE TABLE story_proposals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('entity', 'relation')),
  state          text NOT NULL CHECK (state IN ('detected', 'proposed', 'validated', 'approved', 'canon', 'rejected', 'superseded')),
  -- Сутність: { type, name, canonical, targetId? }; зв'язок: { type, fromId, toId, note }.
  payload        jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  -- Ключ дубля: `entity:<тип>:<назва>` / `entity-edit:<id>` / `relation:<тип>:<від>:<до>`.
  dedupe_key     text NOT NULL CHECK (length(dedupe_key) BETWEEN 3 AND 400),
  evidence       text[] NOT NULL DEFAULT '{}',
  confidence     double precision CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- Походження §25: source, workflowId, workflowVersion, nodeId, ontologyVersion, model, promptVersion, runId, jevDecisions.
  provenance     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance) = 'object'),
  validation     jsonb CHECK (validation IS NULL OR jsonb_typeof(validation) = 'object'),
  -- Що виправив автор при схваленні: { before, after, fields }.
  author_edit    jsonb CHECK (author_edit IS NULL OR jsonb_typeof(author_edit) = 'object'),
  canon_ref      uuid,
  -- Відкладена перевірка: заміна — одна транзакція (стара → superseded, потім нова з тим самим ключем дубля).
  superseded_by  uuid REFERENCES story_proposals (id) DEFERRABLE INITIALLY DEFERRED,
  revision       integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by     text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  decided_by     text CHECK (decided_by IS NULL OR decided_by ~ '^(user|system):.+'),
  decided_at     timestamptz,
  reason         text NOT NULL DEFAULT '' CHECK (length(reason) <= 2000),
  UNIQUE (project_id, id),
  -- AI → PROPOSAL (§24): лише detected / proposed на вході й лише з доказом.
  CONSTRAINT story_proposals_ai_evidence CHECK (created_by NOT LIKE 'ai:%' OR cardinality(evidence) > 0),
  CHECK (state <> 'canon' OR canon_ref IS NOT NULL),
  CHECK (state <> 'superseded' OR superseded_by IS NOT NULL),
  CHECK (state NOT IN ('approved', 'canon', 'rejected') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX story_proposals_state_idx ON story_proposals (project_id, state, created_at DESC);
-- Одна відкрита пропозиція на ключ дубля.
CREATE UNIQUE INDEX story_proposals_open_dedupe ON story_proposals (project_id, dedupe_key)
  WHERE state IN ('detected', 'proposed', 'validated', 'approved');

-- Стани йдуть лише вперед; кінцеві незмінні навіть SQL-ем.
CREATE FUNCTION story_proposals_guard() RETURNS trigger AS $$
DECLARE
  rank_old integer := array_position(ARRAY['detected', 'proposed', 'validated', 'approved'], OLD.state);
  rank_new integer := array_position(ARRAY['detected', 'proposed', 'validated', 'approved'], NEW.state);
BEGIN
  IF OLD.state IN ('canon', 'rejected', 'superseded') THEN
    RAISE EXCEPTION 'Пропозиція в кінцевому стані «%» незмінна (%)', OLD.state, OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Вид, книга й автор пропозиції незмінні (%)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  -- Назад — лише в proposed (правка змісту скидає перевірку).
  IF rank_new IS NOT NULL AND rank_old IS NOT NULL AND rank_new < rank_old AND NEW.state <> 'proposed' THEN
    RAISE EXCEPTION 'Стан пропозиції не повертається з «%» у «%» (%)', OLD.state, NEW.state, OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.state = 'canon' AND OLD.state <> 'approved' THEN
    RAISE EXCEPTION 'У канон — лише схвалена пропозиція (%)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER story_proposals_guard BEFORE UPDATE ON story_proposals FOR EACH ROW EXECUTE FUNCTION story_proposals_guard();

-- Журнал аудиту пропозицій (§25, №16): лише дописується.
CREATE TABLE story_proposal_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   text NOT NULL,
  proposal_id  uuid NOT NULL,
  action       text NOT NULL CHECK (action IN ('create', 'edit', 'propose', 'validate', 'approve', 'reject', 'write_canon', 'supersede')),
  actor        text NOT NULL CHECK (actor ~ '^(user|ai|system):.+'),
  from_state   text,
  to_state     text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, proposal_id) REFERENCES story_proposals (project_id, id) ON DELETE CASCADE
);
CREATE INDEX story_proposal_events_idx ON story_proposal_events (project_id, proposal_id, created_at);
