-- 0004 · Т0.6 — синхронізація книги з ядром (`core_sync`, ТЗ-11 13.4).

-- Зв'язок сутності ядра з об'єктом Студії: `studio:character:<id>` для героя
-- зі списку книги. Імена змінюються — зв'язок ні; за ним синхронізація
-- знаходить ту саму сутність і після перейменування.
ALTER TABLE entities ADD COLUMN external_ref text;
CREATE UNIQUE INDEX entities_external_ref_uidx
  ON entities (project_id, type, external_ref) WHERE external_ref IS NOT NULL;

-- Розділ чи глава, яких більше немає в книзі. Як і абзаци, рядок лишається:
-- на нього посилаються історія й висновки.
ALTER TABLE documents ADD COLUMN deleted_at timestamptz;

-- Номер абзацу в редакторі, якщо він відрізняється від id у ядрі. Буває,
-- коли розділ скопійовано разом із номерами: у книзі ті самі номери стоять
-- двічі, у ядрі кожен абзац мусить мати свій. Копія отримує стабільний id,
-- похідний від (розділ, номер у редакторі), а тут пам'ятається, як її
-- знайти в канві.
ALTER TABLE paragraphs ADD COLUMN editor_pid text;

-- Сповіщення про вплив правок (ТЗ-11 13.4): «після правки абзаців N
-- висновків AI потребують перегляду». Наступні сторінки додадуть свої види
-- (ілюстрації, переклад, хронологія, гілки).
CREATE TABLE core_notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind           text NOT NULL,
  message        text NOT NULL,
  paragraph_ids  text[] NOT NULL DEFAULT '{}',
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  read_at        timestamptz
);
CREATE INDEX core_notifications_project_idx ON core_notifications (project_id, created_at DESC);
