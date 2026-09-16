-- Only routing identifiers are visible outside tenant-scoped transactions.
CREATE VIEW suite.billing_routes WITH (security_barrier=true) AS SELECT customer_id,workspace_id FROM suite.billing_accounts;
GRANT SELECT ON suite.billing_routes TO suite_app;
