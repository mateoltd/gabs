# Workspace switching and offline restart

19 September 2026. **OFF-02-LEASES-WORKSPACE**, within active **OFF-02-LEASES**. Original mappings: **CORE-003, SHELL-001**. Browser acceptance passes; protected native acceptance remains required.

## Correction

A delayed snapshot callback from a closed workspace could overwrite the remembered workspace after a different workspace had saved its offline entry. Workspace teardown now advances the callback generation, and the remembered-identity writer rechecks it after acquiring its serialization lock. The original workspace's scoped snapshot and pending requests remain intact.

The switcher and breadcrumb now use current authorized bootstrap metadata for the selected workspace, including after offline restart. They no longer substitute the generic remembered-entry label when a readable cached workspace name exists. Settings now accurately says that sign-out locks access while retaining saved work. No stylesheet changed.

## Evidence

- The browser regression failed against the pre-fix bundle: after B had saved its identity, releasing A's delayed writer restored A's ID. `/tmp/gabs-workspace-transition-before-fixed-fixture.log` records the exact mismatched IDs.
- Final `tests/e2e/workspace-transition.spec.ts` passes: `/tmp/gabs-workspace-transition-acceptance.log`. It holds the real browser lock request, switches between two real company workspaces, preserves A's original pending envelope, restarts offline into B, returns online to A and recovers the original request. The real server contains one version-2 Contact in A and no Contacts in B; the editor shows the captured phone value. Its isolated database was removed.
- Eight affected profile-authority/sign-out journeys pass on the final product source in `/tmp/gabs-workspace-transition-final-web.log`. That run's new workspace case reached recovery but incorrectly expected the phone in a table that does not display that column; the final case checks its editor and server record. This is nine distinct passing journeys across the affected runs, not one uninterrupted nine-case run. The initial fixture also needed the actual Settings button label.
- Twenty-two focused workspace-policy, client-identity and sign-out tests pass: `/tmp/gabs-workspace-transition-unit.log`.
- Strict root/browser/Node/preload/worker checks, dependency/copy checks and four fresh builds pass: `/tmp/gabs-workspace-transition-final-build.log`. Final fixture types and formatting also pass. Existing bundle-size warnings remain.
- The [offline Settings capture](offline-workspace.png) was inspected. It shows B's actual company name, offline freshness and corrected retention copy. This is functional continuity evidence, not final UI approval.

## Remaining work

The current read-only macOS lock signal is `CGSSessionScreenIsLocked = Yes`. Corporate protected-storage switching/restart acceptance remains unverified; this turn ran no native window and used no protection bypass. The earlier standalone passphrase test does not establish this corporate gate.

Next under OFF-02-LEASES: serialize local offline-storage disable against concurrent journal/draft capture and late snapshot writes. The current UI checks pending work before a separate workspace purge, leaving a race that still needs implementation and real-client acceptance. Installed-release transitions, broader saved-profile/revocation flows, full parity and later UI refinement remain required.
