-- Existing workspaces need a lockable revision before their first policy change.
-- Seed new workspaces in the creation transaction, even before memberships exist.
CREATE OR REPLACE TRIGGER workspace_policy_create AFTER INSERT ON suite.workspaces
 FOR EACH ROW EXECUTE FUNCTION suite.invalidate_workspace_policy();
INSERT INTO suite.workspace_policy(workspace_id,revision)
 SELECT id,0 FROM suite.workspaces
 ON CONFLICT(workspace_id) DO NOTHING;
