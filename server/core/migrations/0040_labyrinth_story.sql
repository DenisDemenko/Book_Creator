-- T9.8: private review drafts, sourced fragments and durable command/generation receipts.
CREATE TABLE labyrinth_story_drafts (
 project_id text NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), run_id uuid NOT NULL,
 map_id uuid NOT NULL, source_hash text NOT NULL, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','accepted','rejected')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 new_book_id text, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,id), UNIQUE(project_id,run_id,source_hash,title),
 FOREIGN KEY(project_id,run_id) REFERENCES labyrinth_runs(project_id,id) ON DELETE CASCADE
);
CREATE TABLE labyrinth_story_requests (
 project_id text NOT NULL,user_id text NOT NULL,key text NOT NULL CHECK(length(key) BETWEEN 1 AND 128),
 draft_id uuid NOT NULL, operation text NOT NULL CHECK(operation IN ('create','edit','rewrite','reject','accept')),
 request_hash text NOT NULL,status text NOT NULL CHECK(status IN ('pending','complete','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,user_id,key),
 FOREIGN KEY(project_id,draft_id) REFERENCES labyrinth_story_drafts(project_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX labyrinth_story_generation_idx ON labyrinth_story_requests(project_id,draft_id)
 WHERE operation='rewrite' AND status='pending';
