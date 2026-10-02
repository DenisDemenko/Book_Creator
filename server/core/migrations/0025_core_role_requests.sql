-- 0025 · Т6.4 В1 — «Моя роль у проєкті»: запит ролі (PLAN_ROLE_STUDIO.md;
-- ТЗ Role Onboarding §23). У чужому проєкті нова роль чи інша спеціалізація —
-- запит власнику (рішення власника §2 п.2); доступ із ним — лише якщо просили.

-- Вид запиту: доступ (Т6.3) чи роль (Т6.4).
ALTER TABLE access_requests ADD COLUMN kind text NOT NULL DEFAULT 'access'
  CHECK (kind IN ('access', 'role'));
-- Призначення, які замінює запит (зміна спеціалізації): відкликаються при схваленні.
ALTER TABLE access_requests ADD COLUMN replaces uuid[] NOT NULL DEFAULT '{}';

-- Рівень доступу в запиті ролі необов'язковий (роль без нового доступу).
ALTER TABLE access_requests ALTER COLUMN level DROP NOT NULL;
ALTER TABLE access_requests ADD CONSTRAINT access_requests_level_kind
  CHECK (kind = 'role' OR level IS NOT NULL);
ALTER TABLE access_requests ADD CONSTRAINT access_requests_role_has_roles
  CHECK (kind = 'access' OR jsonb_array_length(roles) > 0);

-- Схвалений запит ролі може бути без наданого доступу: замінюємо безіменну
-- перевірку «схвалено → є записи доступу» на іменовану з урахуванням виду.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'access_requests'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%cardinality(grant_ids)%'
  LOOP
    EXECUTE format('ALTER TABLE access_requests DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE access_requests ADD CONSTRAINT access_requests_approved_grants
  CHECK (status NOT IN ('approved', 'modified') OR kind = 'role' OR cardinality(grant_ids) > 0);

-- Один нерозглянутий запит кожного виду від людини на проєкт.
DROP INDEX access_requests_one_pending;
CREATE UNIQUE INDEX access_requests_one_pending ON access_requests (project_id, user_id, kind) WHERE status = 'pending';
