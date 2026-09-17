CREATE TABLE suite.module_publishers (
 id text PRIMARY KEY, name text NOT NULL, status text NOT NULL CHECK(status IN ('official','approved','suspended'))
);
INSERT INTO suite.module_publishers VALUES ('suite','Common Suite','official');
CREATE TABLE suite.module_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 module_id text NOT NULL, version text NOT NULL, publisher_id text NOT NULL REFERENCES suite.module_publishers(id),
 client_package jsonb NOT NULL, server_package jsonb,
 backend_kind text NOT NULL CHECK(backend_kind IN ('none','bundled','builtin')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','published')),
 submitted_by text NOT NULL DEFAULT session_user, submitted_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by text, reviewed_at timestamptz, review_reason text,
 staged_at timestamptz, staged_by text,
 UNIQUE(module_id,version),
 CHECK((backend_kind='bundled') = (server_package IS NOT NULL))
);
CREATE TABLE suite.module_review_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 submission_id uuid NOT NULL REFERENCES suite.module_submissions(id),
 actor text NOT NULL DEFAULT session_user, action text NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Preserve previously published immutable releases as an explicit historical baseline.
INSERT INTO suite.module_submissions(module_id,version,publisher_id,client_package,backend_kind,state,reviewed_by,reviewed_at,review_reason,staged_at,staged_by)
 SELECT module_id,version,'suite',jsonb_build_object('module_id',module_id,'version',version,'manifest',manifest,'digest',digest,'signature',signature,'key_id',key_id,'artifact',artifact),
 CASE WHEN artifact->'operations' <> '{}'::jsonb THEN 'builtin' ELSE 'none' END,
 'published',session_user,now(),'Imported pre-review registry baseline',now(),session_user
 FROM suite.module_releases;
INSERT INTO suite.module_review_events(submission_id,action,detail)
 SELECT id,'baseline-import',jsonb_build_object('digest',client_package->>'digest') FROM suite.module_submissions;

CREATE FUNCTION suite.guard_module_review() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state <> 'pending' OR NEW.staged_at IS NOT NULL THEN RAISE EXCEPTION 'Submissions must begin pending and unstaged'; END IF;
  NEW.submitted_by := session_user;
  NEW.submitted_at := now();
 ELSE
  IF ROW(NEW.id,NEW.module_id,NEW.version,NEW.publisher_id,NEW.client_package,NEW.server_package,NEW.backend_kind,NEW.submitted_by,NEW.submitted_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.module_id,OLD.version,OLD.publisher_id,OLD.client_package,OLD.server_package,OLD.backend_kind,OLD.submitted_by,OLD.submitted_at)
  THEN RAISE EXCEPTION 'Submitted artifacts are immutable; increment the version'; END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
   IF NOT ((OLD.state='pending' AND NEW.state IN ('approved','rejected')) OR (OLD.state='approved' AND NEW.state='published'))
   THEN RAISE EXCEPTION 'Invalid review transition'; END IF;
   IF OLD.state='pending' THEN
    IF coalesce(length(trim(NEW.review_reason)),0)=0 THEN RAISE EXCEPTION 'A review reason is required'; END IF;
    NEW.reviewed_by := session_user; NEW.reviewed_at := now();
   END IF;
  END IF;
  IF OLD.state <> 'pending' AND ROW(NEW.review_reason,NEW.reviewed_by,NEW.reviewed_at) IS DISTINCT FROM ROW(OLD.review_reason,OLD.reviewed_by,OLD.reviewed_at)
  THEN RAISE EXCEPTION 'Review decisions are immutable'; END IF;
  IF NEW.staged_at IS DISTINCT FROM OLD.staged_at THEN
   IF OLD.staged_at IS NOT NULL OR OLD.state <> 'approved' OR NEW.staged_at IS NULL THEN RAISE EXCEPTION 'Only approved submissions can be staged once'; END IF;
   NEW.staged_at := now(); NEW.staged_by := session_user;
  ELSIF NEW.staged_by IS DISTINCT FROM OLD.staged_by THEN RAISE EXCEPTION 'Staging identity is immutable';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER module_review_guard BEFORE INSERT OR UPDATE ON suite.module_submissions FOR EACH ROW EXECUTE FUNCTION suite.guard_module_review();
CREATE FUNCTION suite.audit_module_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO suite.module_review_events(submission_id,action,detail) VALUES(NEW.id,
 CASE WHEN TG_OP='INSERT' THEN 'submitted' WHEN NEW.state IS DISTINCT FROM OLD.state THEN NEW.state ELSE 'staged' END,
 jsonb_build_object('clientDigest',NEW.client_package->>'digest','serverDigest',NEW.server_package->>'digest','reason',NEW.review_reason));
 RETURN NEW;
END $$;
CREATE TRIGGER module_review_audit AFTER INSERT OR UPDATE ON suite.module_submissions FOR EACH ROW EXECUTE FUNCTION suite.audit_module_review();
CREATE FUNCTION suite.guard_release_publication() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE submission suite.module_submissions;
BEGIN
 SELECT * INTO submission FROM suite.module_submissions WHERE module_id=NEW.module_id AND version=NEW.version FOR UPDATE;
 IF submission.id IS NULL OR submission.state NOT IN ('approved','published') THEN RAISE EXCEPTION 'Release requires an approved submission'; END IF;
 IF NOT EXISTS(SELECT 1 FROM suite.module_publishers WHERE id=submission.publisher_id AND status='official') THEN RAISE EXCEPTION 'Publisher is not approved for publication'; END IF;
 IF ROW(NEW.digest,NEW.manifest,NEW.signature,NEW.key_id,NEW.artifact) IS DISTINCT FROM
    ROW(submission.client_package->>'digest',submission.client_package->'manifest',submission.client_package->>'signature',submission.client_package->>'key_id',submission.client_package->'artifact')
 THEN RAISE EXCEPTION 'Release bytes differ from the reviewed submission'; END IF;
 IF submission.backend_kind <> 'none' AND submission.staged_at IS NULL THEN RAISE EXCEPTION 'Stage the reviewed backend before publication'; END IF;
 IF submission.state='approved' THEN UPDATE suite.module_submissions SET state='published' WHERE id=submission.id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER release_publication_guard BEFORE INSERT ON suite.module_releases FOR EACH ROW EXECUTE FUNCTION suite.guard_release_publication();
GRANT SELECT ON suite.module_publishers,suite.module_submissions TO suite_app;
GRANT SELECT ON suite.module_publishers,suite.module_submissions,suite.module_review_events TO suite_registry;
GRANT INSERT ON suite.module_submissions TO suite_registry;
GRANT UPDATE(state,review_reason,staged_at) ON suite.module_submissions TO suite_registry;
