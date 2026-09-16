CREATE OR REPLACE FUNCTION suite.guard_submission_contract() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE artifact jsonb := NEW.client_package->'artifact'; has_local boolean; needs_server boolean;
BEGIN
 IF coalesce(NEW.client_package->>'module_id','') <> NEW.module_id OR coalesce(NEW.client_package->>'version','') <> NEW.version
  OR coalesce(artifact->>'publisher','') <> NEW.publisher_id
 THEN RAISE EXCEPTION 'Submission identity differs from its package'; END IF;
 SELECT EXISTS(SELECT 1 FROM jsonb_each(coalesce(artifact->'operations','{}'::jsonb)) op WHERE op.value->>'policy'='local'),
  EXISTS(SELECT 1 FROM jsonb_each(coalesce(artifact->'operations','{}'::jsonb)) op WHERE op.value->>'policy' IS DISTINCT FROM 'local')
  OR coalesce(artifact->'storage'->'migrations','{}'::jsonb) <> '{}'::jsonb
 INTO has_local,needs_server;
 IF NEW.backend_kind='none' AND needs_server
 THEN RAISE EXCEPTION 'Corporate operations and storage migrations require a staged server'; END IF;
 IF has_local AND (coalesce(artifact->'local'->>'format','') <> 'suite-local-v1'
  OR jsonb_typeof(artifact->'local'->'javascript') IS DISTINCT FROM 'string'
  OR coalesce(length(trim(artifact->'local'->>'javascript')),0)=0
  OR octet_length(artifact->'local'->>'javascript') > 2097152)
 THEN RAISE EXCEPTION 'Local operations require a signed local executable bundle'; END IF;
 IF NOT has_local AND artifact ? 'local' THEN RAISE EXCEPTION 'Local executable has no declared local operations'; END IF;
 IF NEW.backend_kind='bundled' AND (NEW.server_package->'payload'->'module' IS DISTINCT FROM (artifact - 'client' - 'local')
  OR coalesce(NEW.server_package->'payload'->>'format','') <> 'suite-server-v1')
 THEN RAISE EXCEPTION 'Submitted client and server contracts differ'; END IF;
 RETURN NEW;
END $$;
