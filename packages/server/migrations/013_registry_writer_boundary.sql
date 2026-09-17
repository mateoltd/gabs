-- Executable release publication belongs to protected release tooling.
-- The ordinary API and worker cannot promote packages into the registry.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
 ON suite.module_releases FROM suite_app, suite_worker, PUBLIC;
GRANT SELECT ON suite.module_releases TO suite_app;

DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='suite_registry') THEN
  CREATE ROLE suite_registry NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE ON SCHEMA suite TO suite_registry;
GRANT SELECT, INSERT ON suite.module_releases TO suite_registry;
