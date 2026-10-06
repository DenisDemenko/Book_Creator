-- Versioned paragraph translations and glossary: one atomic workspace revision.
CREATE TABLE translation_workspaces (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  state JSONB NOT NULL CHECK (jsonb_typeof(state) = 'object')
);
