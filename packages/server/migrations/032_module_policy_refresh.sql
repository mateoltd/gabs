-- Publication is global, but reconciliation state and access changes stay tenant-scoped.
CREATE TABLE suite.registry_revision (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 revision bigint NOT NULL DEFAULT 0
);
INSERT INTO suite.registry_revision(id) VALUES(true);
GRANT SELECT ON suite.registry_revision TO suite_app,suite_worker;
CREATE FUNCTION suite.advance_registry_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE suite.registry_revision SET revision=revision+1 WHERE id=true;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION suite.advance_registry_revision() FROM PUBLIC;
CREATE TRIGGER registry_policy_refresh AFTER INSERT ON suite.module_releases
 FOR EACH ROW EXECUTE FUNCTION suite.advance_registry_revision();

CREATE TABLE suite.module_policy_refresh (
 workspace_id uuid PRIMARY KEY REFERENCES suite.workspaces(id),
 registry_revision bigint NOT NULL CHECK(registry_revision >= 0)
);
ALTER TABLE suite.module_policy_refresh ENABLE ROW LEVEL SECURITY;
ALTER TABLE suite.module_policy_refresh FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suite.module_policy_refresh
 USING(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid)
 WITH CHECK(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON suite.module_policy_refresh TO suite_app;
GRANT SELECT ON suite.module_policy_refresh TO suite_worker;
