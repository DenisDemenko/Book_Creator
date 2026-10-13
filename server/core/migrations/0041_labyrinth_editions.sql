-- T9.9: immutable review versions and separately revocable, version-bound agreements.
CREATE TABLE labyrinth_book_editions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), book_id text NOT NULL,
 source_project_id text NOT NULL, draft_id uuid NOT NULL,
 owner_id text NOT NULL, edition_version integer NOT NULL CHECK(edition_version>0),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), book_revision integer NOT NULL,
 source_book_hash text NOT NULL, snapshot_hash text NOT NULL,
 status text NOT NULL DEFAULT 'review' CHECK(status IN ('review','published','withdrawn')),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 UNIQUE(book_id,edition_version),
 FOREIGN KEY(source_project_id,draft_id) REFERENCES labyrinth_story_drafts(project_id,id)
);
CREATE TABLE labyrinth_edition_agreements (
 edition_id uuid NOT NULL REFERENCES labyrinth_book_editions(id) ON DELETE CASCADE,
 id uuid NOT NULL DEFAULT gen_random_uuid(), user_id text NOT NULL,
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined','withdrawn')),
 snapshot_hash text NOT NULL, payload jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(edition_id,user_id), UNIQUE(edition_id,id)
);
CREATE TABLE labyrinth_edition_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), edition_id uuid NOT NULL REFERENCES labyrinth_book_editions(id),
 actor_id text NOT NULL, kind text NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE labyrinth_edition_requests (
 book_id text NOT NULL,user_id text NOT NULL,key text NOT NULL CHECK(length(key) BETWEEN 1 AND 128),
 request_hash text NOT NULL, edition_id uuid NOT NULL REFERENCES labyrinth_book_editions(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(book_id,user_id,key)
);
CREATE INDEX labyrinth_editions_source_idx ON labyrinth_book_editions(source_project_id);
