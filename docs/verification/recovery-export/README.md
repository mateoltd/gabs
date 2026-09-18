# Scoped recovery export

OFF-01, 18 September 2026. This closes the specific generic-export authorization gap identified in [archived-input recovery](../archived-input/README.md); broader profile, lease and recovery acceptance remains tracked separately.

## Boundaries

Recovery files remain user input, never proof of acceptance or permission to execute a change. Their account, workspace, module and original release are bound to a live module-host session. An uncertain request must agree with the document's module, resource and release. Older schemas and removed fields remain exportable when current read permission still allows recovery; exported values are not rewritten into the new schema.

Electron's former unscoped file-save IPC rejects these requests. The new scoped action chooses the filename in the main process and checks current resource read permission, module/dependency readiness, assignment and entitlement before the OS destination dialog and again after it. Closed view sessions and changed/logged-out profiles cancel delivery. No renderer-selected filesystem path is accepted.

Native recovery authority is separate from publisher device capabilities and LAN grants. Bootstrap policy and dependency metadata come from authenticated main-process API responses; the API verifies published packages before returning them. Renderer cache writes cannot supply permissions or dependency metadata. Offline consent only permits retention of the host's own metadata in protected storage. Offline export requires retained enabled access, an intact dependency closure, no known denial, the configured API origin, a valid lease capped at 24 hours, and no rollback behind the last observed device time. Policy revision changes invalidate retained dependency metadata until it is verified again. Host-classified connection failures may use the retained authority; HTTP denial, malformed responses and other failures cannot.

Web delivery checks the authenticated account and current server policy online. Received policy is applied to the scoped offline snapshot before delivery; this prevents a known revocation from being bypassed by subsequently disconnecting. Offline delivery checks both current view policy and the retained snapshot, including consent, expiry and clock bounds. View changes abort outstanding checks. These are controls within the trusted browser application, not a sandbox against a compromised browser or operating system.

## Actual journeys

The new headless browser journey exports preserved archived input, cancels an outstanding identity check by leaving the view, and verifies a fresh resource-read denial while background policy delivery is unavailable. The changed permission is retained across an offline reload. Regrant restores access; a permitted offline export succeeds, and advancing beyond the lease prevents another download.

The new hidden native journey uses real server permissions and the actual export IPC. It rejects mismatched metadata before opening a destination dialog, verifies saved file bytes, revokes permission while the dialog is held, closes a host session during the dialog, and attempts to restore denied access by changing the renderer-writable snapshot. It then restarts Electron with transport unavailable and verifies protected offline export, expiry while the dialog is open, and logout while the dialog is open. Denied cases produce no file.

Focused authority checks cover scope/release mismatch, read permission, assignment, entitlement, suspension, consent, protected storage availability, restart, clock rollback, denial persistence, issuer changes, in-flight profile purge, stale dependency responses and administrator-shortened/disabled leases.

## Verification

- Strict TypeScript, browser/Node/preload/worker checks, dependency/copy checks and all four builds passed: `/tmp/gabs-recovery-auth-build-final.log`.
- Full unit/PostgreSQL regression passed **457 tests across 81 files**, including nine new authority cases: `/tmp/gabs-recovery-auth-full-final.log`.
- **Nine headless browser journeys** passed: recovery authorization, archived input, ordinary/uncertain generated editors across releases, custom editor migration, both Orders export versions, and browser lease storage: `/tmp/gabs-recovery-auth-web-final.log`.
- **Nine hidden/minimized native journeys** passed: recovery authorization, archived input, both editor-update variants, both IPC/configuration boundaries, both Orders export versions and real TLS LAN leases: `/tmp/gabs-recovery-auth-native-final.log`.
- Changed-file formatting and diff checks passed. Product source remained frozen during serialized final acceptance. Historical screenshots were restored. The generated recovery dialog's wide/narrow web/native captures were inspected for visual continuity; no styles, layout or labels changed. This does not establish final UI polish.

The initial bridge wiring passed excess document properties to a scope-only IPC method; the boundary correctly rejected them, and the caller now passes only account/workspace IDs. The browser harness was corrected to wait for authentication, use the queued review flow when caching is enabled, and isolate the export check from background policy delivery. Its simulated native disconnection now rejects asynchronously like real fetch. One native setup run timed out before enabling offline storage; added diagnostics, a focused rerun and final acceptance did not reproduce it. One full regression run timed out in the unrelated business SDK setup/cleanup hooks (431 passed, 26 skipped); the final fresh isolated run passed all 457. No timeout was increased and no product fix for those non-reproduced setup failures is claimed.

Review additionally separated recovery-metadata failures from unrelated device/LAN capability revocation, and suppressed global error reporting for a deliberately aborted browser export. The final Orders and LAN regressions cover those neighboring boundaries.

## Limits

A destination dialog is replaced by the native test harness so acceptance does not open OS windows. Tests still use the real preload/IPC, authoritative API, protected utility storage and filesystem write. Signed installation, real-provider identity/profile recovery and universal operating-system clock/compromise resistance are not established here. Exporting uncertain input does not submit it, discard it or authorize a fresh retry key.
