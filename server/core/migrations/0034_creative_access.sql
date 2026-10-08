-- Extend the existing grant model; do not create a parallel permission store.
ALTER TABLE access_grants DROP CONSTRAINT access_grants_scope_type_check;
ALTER TABLE access_grants ADD CONSTRAINT access_grants_scope_type_check CHECK(scope_type IN('book','chapter','scene','character','location','object','media_asset','visual_bible','media_library','style_bible','task','deliverable'));
ALTER TABLE access_grants DROP CONSTRAINT access_grants_check1;
ALTER TABLE access_grants ADD CONSTRAINT access_grants_check1 CHECK(level <> 'work' OR scope_type IN('media_library','media_asset'));
