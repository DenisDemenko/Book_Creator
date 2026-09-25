-- 0009 · Т2.2 — емоційний монітор (ТЗ-11, сторінка 4).

-- Емоційна точка героя, що НЕ записана тегом у тексті: автор поставив її чи
-- скоригував точку з тега на сторінці монітора, або підтвердив пропозицію
-- AI-2 (висновок `emotion_point`, можливо з уточненими оцінками).
-- Точки з тегів `[/emotion:страх — 7 @Олена]` тут не зберігаються — вони й так
-- є в згадках і завжди свіжі; запис із тим самим героєм, абзацом і емоцією —
-- ручне коригування тега (текст книги не змінюється).
--   layer      — основна / другорядна / прихована емоція;
--   intensity  — сила емоції героя 0…10;
--   craft      — майстерність передачі в тексті 0…10 (NULL — не оцінено);
--   impact     — вплив на сюжет 0…10 (NULL — не оцінено).
-- Кожна точка має доказ — абзац книги; видалений абзац ховає точку з кривої.
CREATE TABLE emotion_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text NOT NULL,
  character_id  uuid NOT NULL,
  paragraph_id  text NOT NULL,
  emotion       text NOT NULL CHECK (length(btrim(emotion)) BETWEEN 1 AND 80),
  family        text NOT NULL CHECK (family ~ '^[a-z]{2,20}$'),
  layer         text NOT NULL DEFAULT 'primary' CHECK (layer IN ('primary', 'secondary', 'hidden')),
  intensity     smallint NOT NULL CHECK (intensity BETWEEN 0 AND 10),
  craft         smallint CHECK (craft BETWEEN 0 AND 10),
  impact        smallint CHECK (impact BETWEEN 0 AND 10),
  note          text NOT NULL DEFAULT '',
  source        text NOT NULL DEFAULT 'author' CHECK (source IN ('author', 'ai')),
  status        text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
  finding_id    uuid REFERENCES analysis_findings (id) ON DELETE SET NULL,
  created_by    text NOT NULL CHECK (created_by ~ '^(user|ai|system):.+'),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, character_id, paragraph_id, emotion),
  FOREIGN KEY (project_id, character_id) REFERENCES entities (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, paragraph_id) REFERENCES paragraphs (project_id, id) ON DELETE CASCADE
);
CREATE INDEX emotion_points_project_idx ON emotion_points (project_id, character_id);
