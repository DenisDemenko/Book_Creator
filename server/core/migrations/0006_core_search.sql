-- 0006 · Т1.2 — гібридний пошук: слова (tsvector) + сенс (pgvector) + граф.

-- Текст абзацу для пошуку за словами. Теги сутностей лишають своє значення
-- (`[/emotion:страх]` → «страх»: автор сам позначив, що в абзаці страх), а
-- службова частина тега й маркери форматування (`[COLOR="#…"]`) зникають,
-- щоб не засмічувати пошук словами «emotion», «color», «e11d48».
-- Той самий розбір у JS — `server/core/search/text.ts::ftsPlainText`
-- (сховище в пам'яті); змінюючи одне, змініть і друге.
CREATE FUNCTION core_search_text(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN regexp_replace(
    regexp_replace(t, '\[/[a-z0-9Ѐ-ӿ-]+:', ' ', 'g'),
    '\[/?(FONT|SIZE|COLOR|HL|LINK)(=[^\]]*)?\]', ' ', 'g');

-- Конфігурація 'simple': словників української в PostgreSQL немає, тож
-- відмінки закриває запит — він шукає за основою слова з префіксом
-- (`страх` → `стра:*`, знайде «страху», «страхом»).
ALTER TABLE paragraphs
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, core_search_text(text))) STORED;
CREATE INDEX paragraphs_search_tsv_idx ON paragraphs USING gin (search_tsv);

-- Ембединги абзаців — пошук за змістом. Один рядок на (абзац, модель):
-- вектори різних моделей між собою не порівнюються, тож модель — частина
-- ключа, а пошук бере лише рядки поточної моделі. `content_hash` — відбиток
-- тексту БЕЗ тегів, від якого пораховано вектор: абзац переобчислюється лише
-- тоді, коли змінився сам текст (тег, поставлений автором, не коштує виклику).
-- Розмірність одна для всіх моделей — 768 (усі підтримувані моделі вміють
-- віддати вектор такої довжини).
--
-- Індексу HNSW свідомо немає: пошук завжди в межах однієї книги, а точний
-- перебір кількох тисяч абзаців книги швидкий і, на відміну від HNSW з
-- фільтром, не губить результатів. Індекс — коли книги стануть більшими.
CREATE TABLE paragraph_embeddings (
  project_id    text NOT NULL,
  paragraph_id  text NOT NULL,
  model         text NOT NULL,
  content_hash  text NOT NULL,
  embedding     vector(768) NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, paragraph_id, model),
  FOREIGN KEY (project_id, paragraph_id) REFERENCES paragraphs (project_id, id) ON DELETE CASCADE
);
CREATE INDEX paragraph_embeddings_model_idx ON paragraph_embeddings (project_id, model);
