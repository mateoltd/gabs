# Recovering committed work across a mandatory update

16 September 2026. EXT-05 / OFF-03 engineering evidence. Full parity remains open.

## Problem and correction

A queued request could commit successfully while its reply was lost. If the workspace then required a newer module version, checking the update policy before looking up the saved receipt classified that already-accepted work as a conflict. Asking the user to resubmit would misrepresent the outcome and could repeat business effects.

Current identity, workspace access, module availability and declared permissions are checked first. An exact receipt then settles the original request without executing its handler again. Only a request with no receipt proceeds to current rollout, backend and schema compatibility checks. The receipt remains scoped to its actor and workspace and bound to its original operation, input and release through the existing request hash and transaction lock. Changing the input, release or request identity is not an equivalent retry.

For custom operations, the original signed contract supplies the historical declared permission. If the current contract declares a permission for the same operation, that permission is required too. Resolving a historical contract for receipt recovery does not authorize executing it. Resource routes retain their current resource permission check; host-owned business routes retain their current route permission check, including the input-dependent legacy stock check. Suspension and revoked permissions block receipt recovery as well as new work.

This changes the earlier policy milestone's behavior deliberately: a mandatory update rejects new old-version execution, while authorized exact retries can recover a previously committed result. Missing, corrupt or untrusted historical packages are not granted an execution fallback.

## Observable verification

- `tests/module-rollout.test.ts` exercises exact old-version receipts after a mandatory update, simultaneous retries, rejection of new old-version work, altered input/release rejection, current permission revocation/restoration and suspension. Host-owned routes recover prior receipts while refusing new work under an incompatible compiled contract.
- `tests/e2e/module-rollout.spec.ts` now runs both outcomes against separately signed releases. One request was never accepted and remains a reviewable conflict. The other really reaches the server, commits, loses its HTTP reply and disconnects. A separate device makes the update mandatory before reconnect. The journal becomes accepted under its original identity and release, with no superseding request. The updated view displays the saved record after reload, and PostgreSQL contains exactly one record, one create audit entry and one receipt.
- `tests/desktop/boundary.spec.ts` exercises original receipt recovery and rejection of new old-version work through Electron's actual bounded API bridge. The module-level refusal does not lock down the whole desktop application.
- [Recovered browser record](recovered.png) and [narrow view](narrow.png) document the real interface. Visual inspection is not final UI approval.

All 76 unit/PostgreSQL tests, four builds, type/boundary/copy checks and formatting passed. Nineteen distinct focused Chromium journeys passed, along with all six Electron journeys including the new native receipt checks. The two new recovery screenshots were visually inspected at desktop and narrow widths.

An initial background-installation test included every module left by earlier registry fixtures and exceeded its 20-second deadline. Its company now assigns the intended four modules through the real administrator API before entering the workspace. The unchanged polling deadline still requires every assigned module to install; independent published-module activation remains separately covered. The final isolated installation check and all six ordinary business/authorization/offline workflow journeys passed.

Remote CI for the preceding policy commit `dbb13cd` passed code/build checks, all 60 browser journeys, three unsigned packaging jobs and restore. Its read p95 was 637 ms and confirmation 692 ms; OPS-07 remains open against the unchanged 500/1,000 ms budgets. This receipt candidate still requires its own remote run.

## Limits and next work

This closes the demonstrated lost-success-reply case across a mandatory update. Native transport interruption/restart with mixed-version queued work, every active unsaved editor state, fleet rollout progress, partial-failure reporting and connected emergency suspension delivery still need acceptance. OFF-03 also includes broader sign-out, profile removal and revoked-access recovery. Original module operation permissions are enforced as declared; migrating the remaining trusted Orders/Inventory bridges and their conditional business authorization into the public SDK remains SDK-01. Production trust-key rotation and receipt recovery with rotated/revoked signing keys remain EXT-06 work.
