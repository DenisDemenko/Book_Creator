-- 0020 · Т6.1 В2 — учасники проєкту і їхні ролі (PLAN_COLLABORATION.md; ТЗ
-- Graph Studio §46: роль належить участі в проєкті, а не користувачеві; ТЗ
-- Role Onboarding §17: ProjectParticipant, ParticipantRole). Ролі — з реєстру
-- ролей (онтологія `fusion-collab` у реєстрі схем); перевіряє сервіс участі.
-- Людина — `user_id` облікового запису платформи, а не сутність твору: у
-- `entities` її немає (критерій v3 №32). `project_members` лишається як був
-- (старий шлях), його рядки переносяться сюди сервісом.

CREATE TABLE project_participants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL CHECK (length(project_id) BETWEEN 1 AND 200),
  user_id     text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'left')),
  -- Звідки участь: власник книги, запрошення, запит доступу, замовлення біржі, адмін, власник додав вручну, перенесено, онбординг.
  source      text NOT NULL CHECK (source IN ('owner', 'invitation', 'access_request', 'freelance_order', 'admin', 'manual', 'legacy_member', 'onboarding')),
  source_ref  text CHECK (source_ref IS NULL OR length(source_ref) <= 200),
  created_by  text NOT NULL CHECK (created_by ~ '^(user|system):.+'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX project_participants_user_idx ON project_participants (user_id);

CREATE TABLE participant_roles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    uuid NOT NULL REFERENCES project_participants (id) ON DELETE CASCADE,
  project_id        text NOT NULL,
  role_id           text NOT NULL CHECK (role_id ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  specialization    text CHECK (specialization IS NULL OR specialization ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  -- Роль призначає людина чи система, не AI (Onboarding №22, v3 №44).
  assigned_by       text NOT NULL CHECK (assigned_by ~ '^(user|system):.+'),
  -- Версія реєстру ролей, за якою призначено.
  registry_version  integer CHECK (registry_version IS NULL OR registry_version >= 1),
  created_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz,
  revoked_by        text CHECK (revoked_by IS NULL OR revoked_by ~ '^(user|system):.+'),
  CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);
CREATE UNIQUE INDEX participant_roles_active ON participant_roles (participant_id, role_id, COALESCE(specialization, '')) WHERE status = 'active';
CREATE INDEX participant_roles_project_idx ON participant_roles (project_id, role_id) WHERE status = 'active';

-- Журнал змін участі й ролей (Onboarding №27): лише дописується.
CREATE TABLE collab_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text NOT NULL,
  participant_id  uuid REFERENCES project_participants (id) ON DELETE SET NULL,
  action          text NOT NULL CHECK (action IN ('participant_added', 'participant_status', 'role_assigned', 'role_revoked', 'legacy_import')),
  actor           text NOT NULL CHECK (actor ~ '^(user|system):.+'),
  details         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collab_events_idx ON collab_events (project_id, created_at DESC);
