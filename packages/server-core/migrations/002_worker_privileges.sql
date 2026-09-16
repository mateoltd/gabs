REVOKE ALL ON ALL TABLES IN SCHEMA suite FROM suite_worker;
GRANT SELECT ON suite.users,suite.workspaces,suite.memberships,suite.roles,suite.role_assignments,suite.entitlements,suite.module_activations,suite.module_assignments,suite.orders,suite.order_lines,suite.customers,suite.products,suite.stock,suite.stock_movements,suite.invitations,suite.access_requests,suite.outbox,suite.exports,suite.notifications TO suite_worker;
GRANT UPDATE ON suite.outbox,suite.exports TO suite_worker;
GRANT INSERT ON suite.notifications,suite.audit TO suite_worker;
