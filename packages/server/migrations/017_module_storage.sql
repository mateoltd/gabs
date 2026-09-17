CREATE TABLE suite.module_storage (
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), module_id text NOT NULL,
 schema_version integer NOT NULL CHECK(schema_version > 0),
 release_version text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,module_id)
);
CREATE TABLE suite.module_migrations (
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), module_id text NOT NULL,
 from_version integer NOT NULL, to_version integer NOT NULL CHECK(to_version = from_version + 1),
 migration_id text NOT NULL, release_version text NOT NULL, actor_id uuid NOT NULL REFERENCES suite.users(id),
 applied_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,module_id,to_version)
);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['module_storage','module_migrations'] LOOP
  EXECUTE format('ALTER TABLE suite.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE suite.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_isolation ON suite.%I USING (workspace_id = nullif(current_setting(''app.workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id = nullif(current_setting(''app.workspace_id'',true),'''')::uuid)',name);
  EXECUTE format('GRANT SELECT ON suite.%I TO suite_app,suite_worker',name);
 END LOOP;
END $$;
GRANT INSERT,UPDATE ON suite.module_storage TO suite_app;
GRANT INSERT ON suite.module_migrations TO suite_app;
CREATE FUNCTION suite.guard_module_storage_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.schema_version < OLD.schema_version THEN RAISE EXCEPTION 'Stored module schemas cannot be rolled back'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER module_storage_forward_only BEFORE UPDATE ON suite.module_storage FOR EACH ROW EXECUTE FUNCTION suite.guard_module_storage_version();
