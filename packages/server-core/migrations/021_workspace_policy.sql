-- Durable invalidation survives a missed notification or an API process restart.
CREATE TABLE suite.workspace_policy (
 workspace_id uuid PRIMARY KEY REFERENCES suite.workspaces(id),
 revision bigint NOT NULL DEFAULT 0
);
ALTER TABLE suite.workspace_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE suite.workspace_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suite.workspace_policy
 USING(workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid)
 WITH CHECK(workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON suite.workspace_policy TO suite_app;
GRANT SELECT ON suite.workspace_policy TO suite_worker;
CREATE FUNCTION suite.invalidate_workspace_policy() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, suite AS $$
DECLARE target uuid;
BEGIN
 IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME = 'workspaces' THEN
  target := NEW.id;
 ELSE
  IF TG_OP = 'DELETE' THEN target := OLD.workspace_id; ELSE target := NEW.workspace_id; END IF;
 END IF;
 INSERT INTO suite.workspace_policy(workspace_id,revision) VALUES(target,1)
 ON CONFLICT(workspace_id) DO UPDATE SET revision = suite.workspace_policy.revision + 1;
 PERFORM pg_notify('suite_policy',target::text);
 RETURN NULL;
END $$;
CREATE TRIGGER workspace_policy_change AFTER UPDATE OF name, offline_hours, seat_limit, accent, logo_data_url
 ON suite.workspaces FOR EACH ROW EXECUTE FUNCTION suite.invalidate_workspace_policy();
DO $$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['memberships','roles','role_assignments','entitlements','module_activations','module_assignments','platform_settings'] LOOP
  EXECUTE format('CREATE TRIGGER workspace_policy_change AFTER INSERT OR UPDATE OR DELETE ON suite.%I FOR EACH ROW EXECUTE FUNCTION suite.invalidate_workspace_policy()',relation);
 END LOOP;
END $$;
