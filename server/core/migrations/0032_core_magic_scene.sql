CREATE TABLE magic_scene_runs (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 simulation_id UUID NOT NULL,
 revision INTEGER NOT NULL CHECK (revision>0),
 state JSONB NOT NULL CHECK (jsonb_typeof(state)='object'),
 PRIMARY KEY (project_id,simulation_id)
);
