-- 0007 · Т1.3 — збережені пошукові запити сторінки «Розумний пошук» (ТЗ, сторінка 1).

-- Запит зберігає автор для себе: список особистий (user_id), у межах книги.
-- `params` — те, що треба, щоб повторити пошук: текст запиту, фільтри
-- сутностей, глав, періоду й статусу, чи тлумачити запит ШІ. Результати не
-- зберігаються: книга змінюється, і повтор завжди шукає в теперішньому тексті.
CREATE TABLE saved_searches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     text NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_searches_owner_idx ON saved_searches (project_id, user_id, created_at DESC);
