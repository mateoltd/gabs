-- Device observations are separate from authoritative installation receipts.
CREATE TABLE suite.installation_reports (
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id),
 user_id uuid NOT NULL REFERENCES suite.users(id), device_id text NOT NULL,
 module_id text NOT NULL, attempt_id uuid NOT NULL, sequence integer NOT NULL CHECK(sequence > 0),
 version text NOT NULL, phase text NOT NULL CHECK(phase IN ('downloading','confirming','ready','failed')),
 error_code text, receipt_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,user_id,device_id,module_id,attempt_id)
);
CREATE INDEX installation_reports_latest ON suite.installation_reports(workspace_id,module_id,user_id,device_id,created_at DESC);
ALTER TABLE suite.installation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE suite.installation_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suite.installation_reports USING (workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON suite.installation_reports TO suite_app;
GRANT SELECT ON suite.installation_reports TO suite_worker;
