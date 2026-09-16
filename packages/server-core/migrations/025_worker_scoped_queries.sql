-- Export jobs execute reviewed, read-only module queries with workspace RLS.
-- Keep business writes and registry publication outside the worker role.
GRANT SELECT ON suite.module_records,suite.module_submissions,suite.module_publishers TO suite_worker;
