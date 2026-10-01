-- 0021 · Т6.2 В1 — наданий доступ (PLAN_ACCESS.md; ТЗ Graph Studio §49:
-- Access Grant з рівнем і областю; Role Onboarding §19: роль ≠ дозвіл,
-- фактичні права = учасник + проєкт + роль + область + наданий доступ).
-- Доступ належить участі в проєкті; надає людина чи система, не AI (v3 №44).

CREATE TABLE access_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text NOT NULL,
  participant_id  uuid NOT NULL REFERENCES project_participants (id) ON DELETE CASCADE,
  -- view < comment < review < edit < create < approve < manage; work — робочий доступ до медіатеки.
  level           text NOT NULL CHECK (level IN ('view', 'comment', 'review', 'edit', 'create', 'approve', 'manage', 'work')),
  scope_type      text NOT NULL CHECK (scope_type IN ('book', 'chapter', 'scene', 'character', 'location', 'media_library', 'style_bible', 'task', 'deliverable')),
  -- id розділу / сцени (Студія), сутності ядра, завдання…; для книги й медіатеки — немає.
  scope_ref       text CHECK (scope_ref IS NULL OR length(scope_ref) BETWEEN 1 AND 200),
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_until     timestamptz,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'admin', 'legacy_invite')),
  source_ref      text CHECK (source_ref IS NULL OR length(source_ref) <= 200),
  granted_by      text NOT NULL CHECK (granted_by ~ '^(user|system):.+'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_by      text CHECK (revoked_by IS NULL OR revoked_by ~ '^(user|system):.+'),
  CHECK ((scope_type IN ('book', 'media_library')) = (scope_ref IS NULL)),
  CHECK (level <> 'work' OR scope_type = 'media_library'),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);
CREATE INDEX access_grants_participant_idx ON access_grants (participant_id) WHERE status = 'active';
CREATE INDEX access_grants_project_idx ON access_grants (project_id);

-- Журнал участі тепер пише й надання / відкликання доступу (Onboarding №27).
ALTER TABLE collab_events DROP CONSTRAINT collab_events_action_check;
ALTER TABLE collab_events ADD CONSTRAINT collab_events_action_check
  CHECK (action IN ('participant_added', 'participant_status', 'role_assigned', 'role_revoked', 'legacy_import', 'access_granted', 'access_revoked'));
