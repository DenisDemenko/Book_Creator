-- 0024 · Т6.3 В1 — Role Onboarding: сесії опитувальника, запити доступу,
-- налаштування учасника, аналітика входу (PLAN_ROLE_ONBOARDING.md; ТЗ Role
-- Onboarding §17, §20, §25, §28). Ролі людей — онтологія співпраці; у
-- `entities` (канон твору) нічого з цього не потрапляє (№28, №29).

-- Тип проєкту ядра: книга чи курс (`course-<id>`), рішення власника §2 п.1.
ALTER TABLE projects ADD COLUMN project_type text NOT NULL DEFAULT 'book'
  CHECK (project_type ~ '^[a-z][a-z0-9_]{1,39}$');

-- Сесія опитувальника (OnboardingSession, §17): зберігається після кожного
-- кроку (§25); незавершена нічого не надає. Проєкт може ще не бути в ядрі.
CREATE TABLE onboarding_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  project_id       text CHECK (project_id IS NULL OR length(project_id) BETWEEN 1 AND 200),
  project_type     text CHECK (project_type IS NULL OR project_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  entry_intent     text CHECK (entry_intent IS NULL OR entry_intent ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- Точка запуску (§3).
  source           text NOT NULL CHECK (source IN ('first_login', 'marketplace', 'create_project', 'import_project', 'open_project', 'invitation', 'freelance_order', 'new_studio', 'manual')),
  source_order_id  text CHECK (source_order_id IS NULL OR length(source_order_id) BETWEEN 1 AND 200),
  source_ref       text CHECK (source_ref IS NULL OR length(source_ref) <= 200),
  current_step     integer NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 8),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'cancelled')),
  answers          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  result           jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  revision         integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);
-- Одна відкрита чернетка на людину й проєкт (без проєкту — одна загальна).
CREATE UNIQUE INDEX onboarding_sessions_one_draft ON onboarding_sessions (user_id, COALESCE(project_id, '')) WHERE status = 'draft';
CREATE INDEX onboarding_sessions_user_idx ON onboarding_sessions (user_id, updated_at DESC);

-- Запит доступу (AccessRequest, §10, §20): учасник із ролями, але без
-- доступу, просить область і рівень; вирішують власник, адмін або учасник
-- із правом керування — схвалити / змінити / відхилити.
CREATE TABLE access_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      text NOT NULL CHECK (length(project_id) BETWEEN 1 AND 200),
  participant_id  uuid NOT NULL REFERENCES project_participants (id) ON DELETE CASCADE,
  user_id         text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  session_id      uuid REFERENCES onboarding_sessions (id) ON DELETE SET NULL,
  -- [{ roleId, specialization }]
  roles           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(roles) = 'array'),
  -- Область опитувальника (§9) і її цілі; можливості (§10) і рівень доступу Т6.2.
  scope           text NOT NULL CHECK (scope ~ '^[a-z][a-z0-9_]{1,39}$'),
  scope_refs      text[] NOT NULL DEFAULT '{}',
  capabilities    text[] NOT NULL DEFAULT '{}',
  level           text NOT NULL CHECK (level IN ('view', 'comment', 'review', 'edit', 'create', 'approve', 'manage', 'work')),
  message         text NOT NULL DEFAULT '' CHECK (length(message) <= 2000),
  order_id        text CHECK (order_id IS NULL OR length(order_id) BETWEEN 1 AND 200),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'modified', 'rejected', 'cancelled')),
  -- Що надано: { level, scopeType, scopeRefs, validUntil } і id записів доступу.
  decision        jsonb CHECK (decision IS NULL OR jsonb_typeof(decision) = 'object'),
  grant_ids       uuid[] NOT NULL DEFAULT '{}',
  decided_by      text CHECK (decided_by IS NULL OR decided_by ~ '^(user|system):.+'),
  decided_at      timestamptz,
  reason          text NOT NULL DEFAULT '' CHECK (length(reason) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'pending' OR status = 'cancelled' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status NOT IN ('approved', 'modified') OR cardinality(grant_ids) > 0)
);
-- Один нерозглянутий запит людини на проєкт.
CREATE UNIQUE INDEX access_requests_one_pending ON access_requests (project_id, user_id) WHERE status = 'pending';
CREATE INDEX access_requests_project_idx ON access_requests (project_id, status, created_at DESC);

-- Налаштування учасника (ParticipantPreference, §11, §17): ролі першого
-- входу, простір, допомога ШІ. Профіль ШІ ніколи не розширює доступ.
CREATE TABLE participant_preferences (
  user_id       text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  -- '*' — загальні (перший вхід), інакше — проєкт.
  project_id    text NOT NULL CHECK (length(project_id) BETWEEN 1 AND 200),
  roles         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(roles) = 'array'),
  workspace     text CHECK (workspace IS NULL OR workspace ~ '^[a-z][a-z0-9_]{1,39}$'),
  ai_profile    text CHECK (ai_profile IS NULL OR length(ai_profile) <= 80),
  ai_assistance text[] NOT NULL DEFAULT '{}',
  role_details  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(role_details) = 'object'),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

-- Аналітика входу (§28): окремо від канону твору й від журналу співпраці.
CREATE TABLE onboarding_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL CHECK (length(user_id) BETWEEN 1 AND 200),
  session_id  uuid REFERENCES onboarding_sessions (id) ON DELETE SET NULL,
  project_id  text,
  event       text NOT NULL CHECK (event IN ('onboarding_started', 'onboarding_step_completed', 'role_selected', 'role_changed', 'onboarding_completed', 'onboarding_abandoned', 'access_requested', 'access_approved', 'access_rejected', 'studio_entered')),
  details     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_events_idx ON onboarding_events (event, created_at DESC);

-- Журнал співпраці пише й запити доступу (Onboarding №27).
ALTER TABLE collab_events DROP CONSTRAINT collab_events_action_check;
ALTER TABLE collab_events ADD CONSTRAINT collab_events_action_check
  CHECK (action IN ('participant_added', 'participant_status', 'role_assigned', 'role_revoked', 'legacy_import', 'access_granted', 'access_revoked', 'access_requested', 'access_request_decided'));
