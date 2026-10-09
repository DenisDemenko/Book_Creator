-- T9.1: maps/rules, playthroughs and checkpoints live in the existing Core DB.
CREATE TABLE labyrinth_maps (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0),
  PRIMARY KEY(project_id,id)
);
CREATE TABLE labyrinth_versions (
  project_id text NOT NULL,
  map_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision > 0),
  book_revision integer NOT NULL CHECK(book_revision >= 0),
  definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
  hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL CHECK(created_by ~ '^user:.+'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,map_id,revision),
  FOREIGN KEY(project_id,map_id) REFERENCES labyrinth_maps(project_id,id) ON DELETE CASCADE
);
CREATE TABLE labyrinth_runs (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL,
  map_revision integer NOT NULL,
  seed text NOT NULL CHECK(length(seed) BETWEEN 1 AND 128),
  difficulty text NOT NULL DEFAULT 'author_preview' CHECK(difficulty='author_preview'),
  participants jsonb NOT NULL CHECK(jsonb_typeof(participants)='array'),
  revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0),
  state jsonb NOT NULL CHECK(jsonb_typeof(state)='object'),
  created_by text NOT NULL CHECK(created_by ~ '^user:.+'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,id),
  FOREIGN KEY(project_id,map_id,map_revision) REFERENCES labyrinth_versions(project_id,map_id,revision)
);
CREATE INDEX labyrinth_runs_map_idx ON labyrinth_runs(project_id,map_id,created_at DESC);
CREATE TABLE labyrinth_run_events (
  project_id text NOT NULL,
  run_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision >= 0),
  event jsonb NOT NULL CHECK(jsonb_typeof(event)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,run_id,revision),
  FOREIGN KEY(project_id,run_id) REFERENCES labyrinth_runs(project_id,id) ON DELETE CASCADE
);
-- Never overwrite a map snapshot or a checkpoint, including via accidental SQL UPDATE.
CREATE FUNCTION labyrinth_immutable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Labyrinth snapshots are immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER labyrinth_versions_immutable BEFORE UPDATE ON labyrinth_versions
  FOR EACH ROW EXECUTE FUNCTION labyrinth_immutable_snapshot();
CREATE TRIGGER labyrinth_events_immutable BEFORE UPDATE ON labyrinth_run_events
  FOR EACH ROW EXECUTE FUNCTION labyrinth_immutable_snapshot();
