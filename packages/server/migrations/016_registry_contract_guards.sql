CREATE FUNCTION suite.guard_submission_contract() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF coalesce(NEW.client_package->>'module_id','') <> NEW.module_id OR coalesce(NEW.client_package->>'version','') <> NEW.version
  OR coalesce(NEW.client_package->'artifact'->>'publisher','') <> NEW.publisher_id
 THEN RAISE EXCEPTION 'Submission identity differs from its package'; END IF;
 IF NEW.backend_kind='none' AND coalesce(NEW.client_package->'artifact'->'operations','{}'::jsonb) <> '{}'::jsonb
 THEN RAISE EXCEPTION 'Operation-bearing releases require a staged server'; END IF;
 IF NEW.backend_kind='bundled' AND (NEW.server_package->'payload'->'module' IS DISTINCT FROM ((NEW.client_package->'artifact') - 'client')
  OR coalesce(NEW.server_package->'payload'->>'format','') <> 'suite-server-v1')
 THEN RAISE EXCEPTION 'Submitted client and server contracts differ'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER submission_contract_guard BEFORE INSERT ON suite.module_submissions FOR EACH ROW EXECUTE FUNCTION suite.guard_submission_contract();

CREATE OR REPLACE FUNCTION suite.audit_module_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO suite.module_review_events(submission_id,action,detail) VALUES(NEW.id,
 CASE WHEN TG_OP='INSERT' THEN 'submitted' WHEN NEW.state IS DISTINCT FROM OLD.state THEN NEW.state
  WHEN NEW.staged_at IS DISTINCT FROM OLD.staged_at THEN 'staged' ELSE 'metadata-updated' END,
 jsonb_build_object('clientDigest',NEW.client_package->>'digest','serverDigest',NEW.server_package->>'digest','reason',NEW.review_reason));
 RETURN NEW;
END $$;
