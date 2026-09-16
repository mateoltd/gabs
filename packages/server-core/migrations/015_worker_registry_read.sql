-- Export jobs recheck current module dependencies against signed pinned releases.
-- They need registry reads, never publication or review mutations.
GRANT SELECT ON suite.module_releases TO suite_worker;
