# SDK-01: administrator review and coordinated business upgrade

Verified locally on 16 September 2026. Administrators can now review and apply the coordinated Orders/Inventory storage upgrade from Modules. SDK-01 remains active: default releases still use the historical trusted bridges.

## Behavior and authority

- A read-only, repeatable-read review resolves both selected signed releases together, verifies exact staged scoped backends and service contracts, checks activation/configuration/entitlements, and reconciles legacy stock, reservations, order totals and numbering. Review changes no roles, pins, records, audit entries or receipts. It does not execute a migration; final import validation still runs during application.
- New role permissions are explicit administrator selections. Only permissions introduced by the selected releases may be added; existing grants are preserved. Role changes require current `roles.manage`, in addition to `modules.manage` for the upgrade. Foreign roles and unrelated new permissions are rejected.
- The same governance evaluator checks all active assigned members, including opt-in inheritance and explicit denials. The review blocks lost business actions and reports affected people, with a bounded display of the first 100 and a full count. Existing permissions can be adjusted in the central policy interface.
- Orders' product lookup, reservation, release and consumption services require explicit grants. The review token detects changed policy/release selections and is not an authorization credential. Apply takes the exclusive storage lock, reauthorizes, repeats review and validation, and atomically commits selected role additions, service grants, both migrations, mandatory release pins and audit/completion evidence.
- Failure rolls back the entire change even if a caller catches the error. An uncertain response retains the exact request/key for retry. The durable server completion record also recovers the visible outcome after reload. Historical source data remains preserved and write-fenced; old clients must update, with existing offline leases explicitly described.
- Individual schema-1 to schema-2 migration controls direct these two business modules to the coordinated flow. Other module migration behavior is unchanged.

## Verification

- `pnpm check`: **134 tests in 24 files passed**, plus strict TypeScript, dependency boundaries and UI-copy checks. `/tmp/gabs-cutover-check.log`.
- Four application bundles built successfully. `/tmp/gabs-cutover-final-build.log`. API specification/client declarations regenerated: `/tmp/gabs-cutover-generation.log`.
- `tests/business-sdk.test.ts`: **26 signed-package/PostgreSQL/API tests passed**, including read-only review, explicit grants, denied and foreign-role requests, current role-administration authority, stale-policy rejection, exact receipt recovery without repeated audits, and rollback of grants plus both migrations after malformed historical input. Existing business reconciliation, concurrency, scoped queries, export and source-fence checks also passed. `/tmp/gabs-cutover-tests.log`.
- Headless Chromium: the migrated business journey now performs administrator review and cutover through the actual interface, drops an accepted upgrade response, recovers the server outcome, reloads, then continues stock edits/counts, order fulfillment, concurrent-edit review and durable offline retry. `/tmp/gabs-cutover-browser-final.log`. The role checkbox works from the keyboard; Escape closes the completed dialog and restores trigger focus. Axe found no WCAG A/AA violations in the reviewed dialog. This is a scoped automated check, not whole-product accessibility acceptance.
- Hidden/minimized Electron: the actual administrator dialog invokes review and apply through bounded IPC, followed by product creation, receipt, order confirmation and fulfillment. The test verifies private stock `onHand=9`, `reserved=0` and all windows minimized/unfocused. `/tmp/gabs-cutover-desktop.log`.

## Visual scope

The dialog reuses the existing forms, controls, table and modal. The only shared styling change aligns and wraps the module toolbar's additional action. Wide and narrow dialog captures were inspected for text wrapping, reachable controls and horizontal overflow. Long forms scroll within the existing modal.

- [Release and permission choices](choices.png), [narrow choices](choices-narrow.png).
- [Ready review](review.png), [narrow review and apply action](review-narrow.png).
- [Completed web upgrade](completed.png), [hidden native completion](desktop.png).

Only isolated acceptance workspaces were migrated. This evidence does not establish default SDK release promotion, production data cutover, signed desktop deployment, all-theme accessibility, full parity or accepted visual polish. The separately authorized UI refinement goal remains queued after parity.
