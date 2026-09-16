# UI-R02: shared operational lists

Verified 16 September 2026. Scope: People & access, Inventory, Audit, and a shared borderless base for all native table renderers, including Orders, generated module tables and the reusable DataTable. Notification/export rows and virtual list items also use the common borderless treatment. This is a user-authorized update to list presentation, not a resumption of feature parity.

## Changes

- Shared `Table`, `ListTable`, `ListPage`, `ListToolbar`, `SummaryStrip` and `RecordIdentity` primitives. Shared cell spacing, hover/selection fills, rounded geometry and bounded scrolling replace per-row border styling.
- People: seat utilization, pending invitations, searchable members/invitations/roles, quiet identities, status dots and compact actions. Protected roles and member-management payloads are preserved.
- Inventory: workspace-wide product/restocking/available-unit summaries, actionable replenishment count, grouped product/SKU identity, explicit out-of-stock state, consistent movement history and stock controls.
- Audit: readable action labels alongside exact keys, complete target IDs, outcome dots, separate date/time and refresh/pagination with explicit empty/exhausted states.
- Orders retains its bulk selection/actions and exact fulfillment visualization while consuming the same table foundation.

## Verification

| Check                                    | Result                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `tests/e2e/list-design.spec.ts`          | 4 passed in final rerun                                                               |
| `tests/e2e/orders-bulk.spec.ts`          | 5 passed, including real local stock effects                                          |
| `tests/e2e/workflows.spec.ts`            | 5 passed in regression run; remaining overview/design journey passed in focused rerun |
| Existing motion suite                    | 6 passed                                                                              |
| `tests/desktop/list-design.spec.ts`      | 1 passed using real Electron and an isolated temporary profile                        |
| Web and desktop production builds        | Passed                                                                                |
| TypeScript and dependency/UI-copy checks | Passed                                                                                |
| Changed-source formatting                | Passed                                                                                |

The final regression run initially exposed a navigation race in the border-style assertion and an obsolete “Low stock” expectation for zero-stock rows. The former now waits for the destination/results; the latter accepts the new explicit “Out of stock” state. Both passed in focused reruns. No remaining failure in this scope.

Automated checks include member filtering and intercepted access-save payloads, protected Owner controls, invitation-dialog focus, workspace-wide stock filtering, SKU search, stock/history controls, Audit outcomes/full IDs/refresh/pagination, bulk order effects, offline recovery, workspace isolation and existing permissions. Axe reported no WCAG A/AA violations on the four principal list pages in dark and light themes. This is scoped automated coverage, not universal assistive-technology certification.

Screenshots were visually inspected at wide and narrow sizes and in native Electron. The review corrected Audit status colors being overridden by generic CSS. Narrow tables scroll inside their result region rather than widening the viewport. Live member access/invitations were not changed; stock/order regression tests used the local demonstration environment. No production deployment, external message or signed release occurred.

## Screenshots

| View      | Dark web                   | Light web                    | Narrow web                                             | Electron                         |
| --------- | -------------------------- | ---------------------------- | ------------------------------------------------------ | -------------------------------- |
| People    | [Dark](people-dark.png)    | [Light](people-light.png)    | [390px](people-390.png), [768px](people-768.png)       | [Native](electron-people.png)    |
| Inventory | [Dark](inventory-dark.png) | [Light](inventory-light.png) | [390px](inventory-390.png), [768px](inventory-768.png) | [Native](electron-inventory.png) |
| Audit     | [Dark](audit-dark.png)     | [Light](audit-light.png)     | [390px](audit-390.png), [768px](audit-768.png)         | [Native](electron-audit.png)     |
| Orders    | [Dark](orders-dark.png)    | [Light](orders-light.png)    | [390px](orders-390.png), [768px](orders-768.png)       | [Native](electron-orders.png)    |

Additional states: [protected role permissions](role-permissions.png), [stock movements](inventory-history.png). Counts may differ between captures because the local business regression tests create demonstration records.
