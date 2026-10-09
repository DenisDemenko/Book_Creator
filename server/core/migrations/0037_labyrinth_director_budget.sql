-- Durable attempt reservations survive rejected/late replies and outer action rollbacks.
CREATE TABLE labyrinth_director_budget (
 project_id text NOT NULL, run_id uuid NOT NULL, attempts integer NOT NULL CHECK(attempts BETWEEN 0 AND 1000),
 PRIMARY KEY(project_id,run_id),
 FOREIGN KEY(project_id,run_id) REFERENCES labyrinth_runs(project_id,id) ON DELETE CASCADE
);
