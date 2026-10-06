CREATE TABLE secret_vaults (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK (revision>0),
 state JSONB NOT NULL CHECK (jsonb_typeof(state)='object')
);
CREATE FUNCTION protect_secret_vault() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE s JSONB; n JSONB; i INTEGER;
BEGIN
 IF TG_OP='DELETE' THEN IF NOT EXISTS (SELECT 1 FROM projects WHERE id=OLD.project_id) THEN RETURN OLD; END IF; RAISE EXCEPTION 'secret vault is append only'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.state->'plans') WITH ORDINALITY a(v,ord) WHERE NEW.state->'plans'->(ord::INTEGER-1) IS DISTINCT FROM v) THEN RAISE EXCEPTION 'immutable director plans'; END IF;
 IF jsonb_array_length(NEW.state->'audit') <> jsonb_array_length(OLD.state->'audit')+1 THEN RAISE EXCEPTION 'immutable vault audit'; END IF;
 FOR i IN 0..jsonb_array_length(OLD.state->'audit')-1 LOOP
  IF NEW.state->'audit'->i IS DISTINCT FROM OLD.state->'audit'->i THEN RAISE EXCEPTION 'immutable vault audit'; END IF;
 END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(OLD.state->'secrets') LOOP
  SELECT value INTO n FROM jsonb_array_elements(NEW.state->'secrets') WHERE value->>'id'=s->>'id';
  IF n IS NULL THEN RAISE EXCEPTION 'secret cannot be removed'; END IF;
  IF (s-'versions'-'used'-'frozen'-'status'-'authorRevealed'-'revealedSceneId') IS DISTINCT FROM (n-'versions'-'used'-'frozen'-'status'-'authorRevealed'-'revealedSceneId') THEN RAISE EXCEPTION 'secret identity immutable'; END IF;
  FOR i IN 0..jsonb_array_length(s->'versions')-1 LOOP
   IF n->'versions'->i IS DISTINCT FROM s->'versions'->i THEN RAISE EXCEPTION 'secret version is immutable'; END IF;
  END LOOP;
  IF ((s->>'used')::boolean OR (s->>'frozen')::boolean OR s->>'status'<>'sealed') AND jsonb_array_length(n->'versions')<>jsonb_array_length(s->'versions') THEN RAISE EXCEPTION 'used secret cannot be regenerated'; END IF;
  IF (s->>'used')::boolean AND NOT (n->>'used')::boolean OR (s->>'frozen')::boolean AND NOT (n->>'frozen')::boolean THEN RAISE EXCEPTION 'secret cannot be unlocked'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER secret_vault_immutable BEFORE UPDATE OR DELETE ON secret_vaults FOR EACH ROW EXECUTE FUNCTION protect_secret_vault();
