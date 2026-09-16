CREATE TABLE suite.stock_counts (
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id),
 id uuid NOT NULL,
 product_id uuid NOT NULL,
 expected_version integer NOT NULL,
 previous_on_hand integer NOT NULL,
 counted_on_hand integer NOT NULL CHECK (counted_on_hand BETWEEN 0 AND 1000000000),
 reason text NOT NULL,
 actor_id uuid NOT NULL REFERENCES suite.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,product_id) REFERENCES suite.stock(workspace_id,product_id)
);
ALTER TABLE suite.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE suite.stock_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suite.stock_counts USING (workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid);
GRANT SELECT, INSERT ON suite.stock_counts TO suite_app;
