-- Retain role identity for invitation history and audit while removing it from access.
ALTER TABLE suite.roles ADD COLUMN retired_at timestamptz;
ALTER TABLE suite.roles ADD CONSTRAINT protected_roles_remain_active
 CHECK (NOT protected OR retired_at IS NULL);
ALTER TABLE suite.roles DROP CONSTRAINT roles_workspace_id_name_key;
CREATE UNIQUE INDEX roles_active_name ON suite.roles(workspace_id,name)
 WHERE retired_at IS NULL;
