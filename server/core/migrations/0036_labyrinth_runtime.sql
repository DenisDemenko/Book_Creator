ALTER TABLE labyrinth_runs ADD COLUMN mode text NOT NULL DEFAULT 'structural' CHECK(mode IN ('structural','runtime'));
CREATE TABLE labyrinth_action_receipts (
 project_id text NOT NULL, run_id uuid NOT NULL, key text NOT NULL CHECK(length(key) BETWEEN 1 AND 128),
 request_hash text NOT NULL, response jsonb NOT NULL,
 PRIMARY KEY(project_id,run_id,key),
 FOREIGN KEY(project_id,run_id) REFERENCES labyrinth_runs(project_id,id) ON DELETE CASCADE
);
