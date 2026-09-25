-- 0008 · Т2.1 — хронологія: час подій і сцен у світі книги (ТЗ, сторінка 6).

-- Точка часу для сцени (розділ книги) або події (сутність /event…). Порядок
-- розкриття читачеві (`narrative_order`) окремо не зберігається — це порядок
-- розділів у книзі; тут лише час у світі (`story_time`). `sort_key` —
-- число для впорядкування (src/utils/storyTime.ts); у невизначеної точки його
-- немає. Одна точка на сцену чи подію; зміна — нова версія рядка з тим самим
-- ключем (історію правок веде журнал дій Студії).
CREATE TABLE story_time_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subject_kind  text NOT NULL CHECK (subject_kind IN ('scene', 'event')),
  subject_id    text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('exact', 'approximate', 'interval', 'unknown')),
  start_value   text,
  end_value     text,
  sort_key      double precision,
  end_key       double precision,
  label         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  source        text NOT NULL DEFAULT 'author' CHECK (source IN ('author', 'ai', 'tag')),
  evidence      text[] NOT NULL DEFAULT '{}',
  created_by    text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, subject_kind, subject_id),
  CHECK (kind = 'unknown' OR sort_key IS NOT NULL),
  CHECK (kind <> 'interval' OR (end_key IS NOT NULL AND end_key >= sort_key))
);
