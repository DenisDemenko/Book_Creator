-- T9.7: bound members, frozen group rules, private knowledge and consented contributions.
ALTER TABLE labyrinth_runs DROP CONSTRAINT labyrinth_runs_difficulty_check;
ALTER TABLE labyrinth_runs ADD CONSTRAINT labyrinth_runs_difficulty_check
 CHECK(difficulty IN ('author_preview','reader','reader_group'));
CREATE TABLE labyrinth_groups (
 project_id text NOT NULL,run_id uuid NOT NULL,map_id uuid NOT NULL,publication_revision integer NOT NULL,
 rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='object'),
 status text NOT NULL DEFAULT 'lobby' CHECK(status IN ('lobby','playing','finished')),
 cursor integer NOT NULL DEFAULT 0 CHECK(cursor>=0), deadline_at timestamptz, decision jsonb,
 PRIMARY KEY(project_id,run_id),
 FOREIGN KEY(project_id,run_id) REFERENCES labyrinth_runs(project_id,id) ON DELETE CASCADE,
 FOREIGN KEY(project_id,map_id,publication_revision) REFERENCES labyrinth_reader_editions(project_id,map_id,revision) ON DELETE CASCADE
);
CREATE TABLE labyrinth_group_members (
 project_id text NOT NULL,run_id uuid NOT NULL,hero_id text NOT NULL,user_id text,
 alias text NOT NULL CHECK(length(alias) BETWEEN 1 AND 80),
 status text NOT NULL CHECK(status IN ('invited','active','left')),
 candidate boolean NOT NULL DEFAULT false,terms text,
 visited jsonb NOT NULL CHECK(jsonb_typeof(visited)='array'),
 heading text NOT NULL DEFAULT 'north' CHECK(heading IN ('north','east','south','west')),
 PRIMARY KEY(project_id,run_id,hero_id),UNIQUE(project_id,run_id,user_id),
 FOREIGN KEY(project_id,run_id) REFERENCES labyrinth_groups(project_id,run_id) ON DELETE CASCADE
);
CREATE INDEX labyrinth_group_users_idx ON labyrinth_group_members(project_id,user_id);
CREATE TABLE labyrinth_group_requests (
 project_id text NOT NULL,user_id text NOT NULL,key text NOT NULL CHECK(length(key) BETWEEN 1 AND 128),
 request_hash text NOT NULL,run_id uuid NOT NULL,PRIMARY KEY(project_id,user_id,key),
 FOREIGN KEY(project_id,run_id) REFERENCES labyrinth_groups(project_id,run_id) ON DELETE CASCADE
);
CREATE TABLE labyrinth_group_messages (
 project_id text NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 hero_id text NOT NULL,user_id text NOT NULL,alias text NOT NULL,
 channel text NOT NULL CHECK(channel IN ('player_chat','hero_dialogue','contribution')),
 text text NOT NULL CHECK(length(text) BETWEEN 1 AND 8000),recipients jsonb NOT NULL,
 source_revision integer NOT NULL,map_revision integer NOT NULL,node_id text NOT NULL,
 ai_assisted boolean NOT NULL DEFAULT false,consent_active boolean NOT NULL DEFAULT false,terms text,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,run_id,id),
 FOREIGN KEY(project_id,run_id,hero_id) REFERENCES labyrinth_group_members(project_id,run_id,hero_id) ON DELETE CASCADE
);
CREATE INDEX labyrinth_group_messages_idx ON labyrinth_group_messages(project_id,run_id,created_at);
