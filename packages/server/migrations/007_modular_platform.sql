ALTER TABLE suite.entitlements DROP CONSTRAINT IF EXISTS entitlements_module_id_check;
ALTER TABLE suite.workspaces DROP CONSTRAINT IF EXISTS workspaces_offline_hours_check;
ALTER TABLE suite.workspaces ADD CONSTRAINT workspaces_offline_hours_check CHECK (offline_hours BETWEEN 0 AND 24);
ALTER TABLE suite.workspaces ALTER COLUMN offline_hours SET DEFAULT 24;
CREATE TABLE suite.module_records (
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), module_id text NOT NULL, resource text NOT NULL,
 id uuid NOT NULL, data jsonb NOT NULL, version integer NOT NULL DEFAULT 1, archived boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES suite.users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,module_id,resource,id)
);
CREATE INDEX module_records_search ON suite.module_records USING gin (to_tsvector('simple',data::text));
CREATE TABLE suite.module_revisions (
 workspace_id uuid NOT NULL, module_id text NOT NULL, resource text NOT NULL, record_id uuid NOT NULL,
 version integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY(workspace_id,module_id,resource,record_id,version),
 FOREIGN KEY(workspace_id,module_id,resource,record_id) REFERENCES suite.module_records(workspace_id,module_id,resource,id)
);
CREATE TABLE suite.platform_settings (
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), key text NOT NULL, value jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, PRIMARY KEY(workspace_id,key)
);
CREATE TABLE suite.module_installations (
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), user_id uuid NOT NULL REFERENCES suite.users(id),
 device_id text NOT NULL, module_id text NOT NULL, version text NOT NULL, state text NOT NULL CHECK(state IN ('installed','removed')),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,user_id,device_id,module_id)
);
CREATE TABLE suite.module_releases (
 module_id text NOT NULL, version text NOT NULL, manifest jsonb NOT NULL, digest text NOT NULL,
 signature text NOT NULL, key_id text NOT NULL, artifact jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(module_id,version)
);
CREATE TABLE suite.billing_accounts (
 workspace_id uuid PRIMARY KEY REFERENCES suite.workspaces(id), customer_id text UNIQUE NOT NULL,
 subscription_id text UNIQUE, status text NOT NULL DEFAULT 'pending', last_event_at bigint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE suite.billing_events (id text PRIMARY KEY, type text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['module_records','module_revisions','platform_settings','module_installations','billing_accounts'] LOOP
  EXECUTE format('ALTER TABLE suite.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE suite.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_isolation ON suite.%I USING (workspace_id = nullif(current_setting(''app.workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id = nullif(current_setting(''app.workspace_id'',true),'''')::uuid)',name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON suite.%I TO suite_app',name);
 END LOOP;
END $$;
GRANT SELECT, INSERT ON suite.module_releases TO suite_app;
GRANT SELECT, INSERT ON suite.billing_events TO suite_app;
