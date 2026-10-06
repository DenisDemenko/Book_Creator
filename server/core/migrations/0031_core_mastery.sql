CREATE TABLE mastery_workspaces (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK (revision>0),
 state JSONB NOT NULL CHECK (jsonb_typeof(state)='object'),
 PRIMARY KEY (project_id,user_id)
);
