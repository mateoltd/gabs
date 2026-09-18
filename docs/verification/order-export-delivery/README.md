# Scoped Orders export delivery acceptance

18 September 2026. SDK-05 prerequisite; official capability adoption and full parity remain open.

## Implemented behavior

The Orders export modal now calls a scoped host-job delivery adapter. Browser delivery validates the returned file, rechecks current API authorization and checks the mounted account/workspace/release before offering a download. Requests use the view's cancellation signal.

Electron accepts an opaque Orders module session and export identifier. Main validates server-owned readiness metadata before the dialog, then retrieves the CSV under fresh server authorization after the dialog. It checks the same active session before writing. Renderer-supplied CSV is rejected by the former generic save IPC, which now accepts only schema-validated input-recovery files. Server metadata and data lookups both require the original actor, workspace, current permission and module availability. The new readiness endpoint adds no download audit entry. Download records describe server data retrieval, not OS write completion.

Session capture reuses the existing main-process session invalidation logic. Orders cancels pending contexts on unmount or account/workspace/release changes. Expected cancellation does not show a stale error in the next view. Native failures cross IPC as explicit results, so the product shows the permission explanation without Electron method names.

## Verification

- Five focused unit/session tests passed, including current-authority retrieval after the dialog, cancellation before retrieval, revoked access, stale sessions and mismatched filenames.
- Five headless browser journeys passed: actual worker-generated Orders CSV, late permission rejection without a second download, and four generated/custom editor update/recovery regressions.
- Five hidden native journeys passed: two renderer/storage/sign-in boundaries, existing corporate host actions, offline corporate leases and official Orders export delivery. The affected Orders journey passed again after the error-envelope correction, including scoped dialog Axe checks and exact user-facing error text.
- The Orders native journey uses actual API/worker/storage/file operations. It verifies expected CSV bytes, exactly one download audit after a successful save, unchanged counts and absent files after held-dialog revocation/navigation, generic CSV IPC rejection, and hidden/unfocused windows. Save-dialog paths are controlled by the test; no OS dialog or notification interrupts the desktop.
- Strict root and browser/Node/preload/worker TypeScript checks, boundary/copy checks and all four builds passed. The final native-only build reused the three unchanged application bundles. OpenAPI and typed client declarations were regenerated against an isolated migrated/seeded PostgreSQL database.
- [The final native capture](native.png) was inspected after correcting the IPC-prefixed error. Existing Orders structure and styles remain unchanged. Historical screenshots overwritten by regressions were restored.

Logs: `/tmp/gabs-export-unit.log`, `/tmp/gabs-export-api.log`, `/tmp/gabs-export-build.log`, `/tmp/gabs-export-build-final.log`, `/tmp/gabs-export-browser.log`, `/tmp/gabs-export-native.log`, `/tmp/gabs-export-native-final.log`. All isolated runners completed and removed their own databases. Shared development previews were preserved.

## Scope and remaining work

This secures host-owned background-export delivery for current and pinned Orders releases. It does not add a capability declaration to an existing signed release or complete independent official-view adoption. [The effect ownership audit](../../official-capability-adoption.md) records the next new signed capability release, administrator review and distinct host recovery/inbox responsibilities. Real identity/profile recovery, native LAN, notification presentation, cross-OS packaging and overall parity remain open. No UI refinement goal was started.
