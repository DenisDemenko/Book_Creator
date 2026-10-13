-- T9.6: explicit author release, private solo sessions, durable fog/checkpoints.
CREATE TABLE labyrinth_reader_heads (
  project_id text NOT NULL,
  map_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0),
  active boolean NOT NULL DEFAULT false,
  revoked_through integer NOT NULL DEFAULT 0 CHECK(revoked_through >= 0),
  PRIMARY KEY(project_id,map_id),
  FOREIGN KEY(project_id,map_id) REFERENCES labyrinth_maps(project_id,id) ON DELETE CASCADE
);
CREATE TABLE labyrinth_reader_editions (
  project_id text NOT NULL, map_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision > 0),
  map_revision integer NOT NULL,
  book_revision integer NOT NULL CHECK(book_revision >= 0),
  hero_ids jsonb NOT NULL CHECK(jsonb_typeof(hero_ids)='array'),
  scenes jsonb NOT NULL CHECK(jsonb_typeof(scenes)='object'),
  created_by text NOT NULL CHECK(created_by ~ '^user:.+'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,map_id,revision),
  FOREIGN KEY(project_id,map_id,map_revision) REFERENCES labyrinth_versions(project_id,map_id,revision) ON DELETE CASCADE
);
CREATE TRIGGER labyrinth_reader_editions_immutable BEFORE UPDATE ON labyrinth_reader_editions
  FOR EACH ROW EXECUTE FUNCTION labyrinth_immutable_snapshot();
CREATE TABLE labyrinth_reader_sessions (
  project_id text NOT NULL, run_id uuid NOT NULL, user_id text NOT NULL,
  map_id uuid NOT NULL, publication_revision integer NOT NULL,
  hero_id text NOT NULL,
  visited jsonb NOT NULL CHECK(jsonb_typeof(visited)='array'),
  heading text NOT NULL CHECK(heading IN ('north','east','south','west')),
  PRIMARY KEY(project_id,run_id),
  FOREIGN KEY(project_id,run_id) REFERENCES labyrinth_runs(project_id,id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,map_id,publication_revision) REFERENCES labyrinth_reader_editions(project_id,map_id,revision) ON DELETE CASCADE
);
CREATE INDEX labyrinth_reader_user_idx ON labyrinth_reader_sessions(project_id,user_id);
CREATE TABLE labyrinth_reader_requests (
  project_id text NOT NULL, user_id text NOT NULL,
  key text NOT NULL CHECK(length(key) BETWEEN 1 AND 128),
  request_hash text NOT NULL, run_id uuid NOT NULL,
  PRIMARY KEY(project_id,user_id,key),
  FOREIGN KEY(project_id,run_id) REFERENCES labyrinth_reader_sessions(project_id,run_id) ON DELETE CASCADE
);

ALTER TABLE labyrinth_runs DROP CONSTRAINT labyrinth_runs_difficulty_check;
ALTER TABLE labyrinth_runs ADD CONSTRAINT labyrinth_runs_difficulty_check
  CHECK(difficulty IN ('author_preview','reader'));
