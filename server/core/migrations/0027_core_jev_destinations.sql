-- 0027 · Т5.5 В1 — шар рішень Jev (PLAN_JEV_NODES.md; ТЗ Graph Studio §10,
-- §39 №10): реєстр напрямків маршрутизатора Jev і запуск-підпроцес.
--
-- Реєстр напрямків — окремий список у Graph Studio (рішення власника §2 п.2):
-- реєстр → варіант → процес. Маршрутизатор із реєстром бачить новий напрямок
-- без правки себе; опис іде в Jev як опис варіанта.

CREATE TABLE workflow_destinations (
  registry           text NOT NULL CHECK (registry ~ '^[a-z][a-z0-9_]{0,63}$'),
  option             text NOT NULL CHECK (option ~ '^[a-z][a-z0-9_]{0,63}$'),
  label_en           text NOT NULL CHECK (length(label_en) BETWEEN 1 AND 200),
  label_uk           text NOT NULL CHECK (length(label_uk) BETWEEN 1 AND 200),
  description        text NOT NULL DEFAULT '' CHECK (length(description) <= 255),
  workflow_id        text NOT NULL REFERENCES workflows (id),
  enabled            boolean NOT NULL DEFAULT true,
  updated_by         text NOT NULL CHECK (updated_by ~ '^(user|system):.+'),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (registry, option)
);
CREATE INDEX workflow_destinations_workflow_idx ON workflow_destinations (workflow_id);

-- Підпроцес (вузол SUBGRAPH і маршрутизатор із реєстром): дочірній запуск із
-- батьківським, режим `subgraph`, джерело `subgraph`.
ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_mode_check;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_mode_check CHECK (mode IN ('normal', 'replay', 'fork', 'subgraph'));
ALTER TABLE workflow_runs DROP CONSTRAINT workflow_runs_trigger_check;
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_runs_trigger_check CHECK (trigger ~ '^(job:[a-z_]{1,40}|interview|manual|replay|fork|subgraph)$');
CREATE INDEX workflow_runs_parent_idx ON workflow_runs (parent_run_id) WHERE parent_run_id IS NOT NULL;
