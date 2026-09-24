-- 0005 · Т0.9 — три ролі AI: доказ висновку — абзац АБО зображення.
--
-- ТЗ-11 13.2: висновок без посилання «на абзац, сцену чи зображення»
-- зберігається лише з позначкою «недостатньо даних». Для AI-3 (візуальний
-- аналіз) доказом є ілюстрація з медіатеки, а не абзац, тож обмеження бази
-- розширюється: AI-висновок приймається з абзацами, або з зображеннями, або
-- з чесною позначкою.

ALTER TABLE analysis_findings ADD COLUMN source_asset_ids text[] NOT NULL DEFAULT '{}';

ALTER TABLE analysis_findings DROP CONSTRAINT analysis_findings_ai_evidence;
ALTER TABLE analysis_findings ADD CONSTRAINT analysis_findings_ai_evidence
  CHECK (created_by NOT LIKE 'ai:%'
         OR cardinality(source_paragraph_ids) > 0
         OR cardinality(source_asset_ids) > 0
         OR insufficient_data);
