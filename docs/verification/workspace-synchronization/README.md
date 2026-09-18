# Workspace-wide synchronization

Status: locally verified OFF-01 milestone, 18 September 2026. Full OFF-01 and product parity remain active.

## Behavior and ownership

The corporate workspace owns automatic synchronization while the application is open. It runs on connection/policy changes and every 15 seconds, without mounting module views or executing their client code. Generated resource writes, custom-command capture and explicit retries use the same coordinator. The former view-owned automatic dispatch loops have been removed; saved-command inspection retains its read-only refresh.

Before a pass, the coordinator reads the scoped journal and current server installation/catalog state. It verifies installed packages, dependency releases, accepted version pins and storage compatibility using the existing installation verifier. It verifies each original response contract and requires both original/current queued policies and operation grants; resource writes also require read/write grants. Missing historical contracts hold their own work without blocking unrelated eligible changes. Removed/reclassified operations cannot be dispatched. Uninstall pauses dispatch, including a manual retry initiated from another module. The installation is checked again immediately before transport.

The existing workspace journal lock serializes automatic and explicit passes across browser contexts. Its durable identities, dependency ordering, uncertainty, response validation and server idempotency remain authoritative. A definitive rejection does not block unrelated work. A policy revision, expired access, disconnected client or changed account/workspace stops further dispatch. A late authentication failure cannot lock a different active workspace.

Removing a view alone does not pause a still-installed, authorized queued operation. Settings recovery remains an inspection/settlement interface; the workspace coordinator may independently complete eligible work while Settings is open. This intentionally supersedes earlier tests that used navigation away from a module as an execution pause.

## Acceptance scope

The new browser/native journey installs two independently published SDK fixtures, captures offline commands and a dependent command, restarts offline, selects Settings and reconnects without reopening either module. A real committed reply is lost. Assertions require exact original calls/dependencies, accepted/rejected states, server records and duplicate-free audit counts across both modules. Native windows remain hidden/minimized and unfocused.

Unit coverage exercises real signed contracts and durable storage: concurrent coordinators, original-key lost-reply retry, rejection independence, missing historical metadata, installation removal, revoked grants, policy/scope changes, mixed resource/command prerequisites and late authentication failure. Browser/native regressions cover same-record/legacy ordering, cross-module capture, view removal/uninstall recovery, lease expiry, received revocation and upgrades.

## Final-source verification

- `pnpm build`: strict root/browser/Node/preload/worker checks, boundary/copy checks and four fresh production builds passed. Existing bundle-size warnings remain. Log: `/tmp/gabs-workspace-sync-build-final.log`.
- Twelve headless browser journeys passed together on final source in `/tmp/gabs-workspace-sync-web-acceptance.log`.
- Twelve hidden/minimized, unfocused Electron journeys passed together on final source in `/tmp/gabs-workspace-sync-native-acceptance.log`.
- The full unit/PostgreSQL regression passed 523 tests across 87 files in `/tmp/gabs-workspace-sync-regression.log`.
- Changed TypeScript/package formatting and `git diff --check` passed.
- Four final wide/narrow web/native Settings captures in this directory were inspected. Layout, wrapping and scroll behavior preserve the existing interface. Scoped keyboard/Axe checks passed in the recovery regressions. No stylesheet or visual component changed. This is continuity evidence, not final UI approval or whole-product AAA conformance.

The final client suites include the shared explicit-retry path and supersede all intermediate runs. Earlier failures/corrections are recorded below; there is no cumulative or inferred final pass count.

## Review and fixture corrections during implementation

Final review routed explicit resource and command retries through the same coordinator, closing the older cross-module dispatch path that lacked installation checks. The former shell-only permission implementation moved to the client package, shared by inspection and dispatch; the forwarding shim was removed. Both final client suites ran after these source changes.

- Existing viewless-command acceptance expected an independent still-public command to remain pending. It now requires its accepted outcome and corresponding server record; retired operations and blocked children must still remain undispatched.
- Record-recovery fixtures now revoke write permission before reconnecting to update/uninstall. This preserves actual pending input through the transition instead of relying on closing the resource view. Original zero-attempt, preserved-input and settlement assertions remain intact.
- The two-module journey waits for the specific module region and persisted installation before going offline; identical buttons in a preserved previous view were insufficient evidence of installation readiness.
- A native cold start opens Overview. The journey selects Settings after restart and scopes its navigation locator to Preferences, avoiding the disabled breadcrumb with the same name.
- Initial unit fixture errors (root import resolution, short retry identities, error-detail argument position and installation metadata) were corrected without relaxing production validation.

98 historical PNGs overwritten by these runs were restored from the preceding commit. This directory retains only the four new milestone captures.

## Remaining gates

This milestone does not complete OFF-01, OFF-03 or platform parity. Remaining required work includes broader custom/archive dependent recovery, cross-module/resource continuation decisions, submitted-child outcomes, remaining source-schema/legacy transitions, full scheduling simulation and sign-out/profile-removal recovery. Execution while the application is closed is not established by these in-app coordinator journeys. Final UI refinement, provider/signed-release acceptance and the separate earlier intermittent native dialog/concurrent Orders concerns remain open.
