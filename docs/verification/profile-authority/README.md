# Profile authority and recovery

19 September 2026. Tracker: **OFF-02-LEASES-PROFILE**, within active **OFF-02-LEASES/OFF-02**. Original coverage: **CORE-003/SHELL-001**. Native and broader context/profile acceptance remain required.

## Changes

Workspace clients carry an expected actor. The API compares that expectation with the authenticated session/bearer actor before executing business effects; it does not treat the header as an identity claim. Authenticated responses identify their actor. HTTP and narrow desktop IPC preserve this evidence, including cross-origin header configuration. A successful bound response without actor evidence fails closed with an actionable server-update error.

The shared client orders identity observations, rejects responses from an obsolete session, ignores old-account/duplicate invalidation notifications and pins each workspace client to its original account. Public connectivity probes remain independent of identity changes. The shell clears stale account query data and remembered entry after confirmed credential denial or a different identity, including the first authentication request after restart. Remembered-identity writes share a lock and recheck the active account, so an old workspace cannot restore its entry after invalidation.

A durable per-account revision expires saved workspace leases and pre-transition policy requests without purging cached records, journals or drafts. Account invalidation broadcasts lock other same-origin tabs, including tabs unable to obtain a new identity through HTTP. Only fresh authenticated policy acceptance stamps a saved snapshot with the current revision. Standalone personal work remains separate; corporate registry access uses a bound client.

Desktop transport adds expected-actor validation, authenticated response evidence, main-process request/identity ordering and protected account revision storage. It retains existing protected-storage and sender checks. Its actual protected-storage/process-restart acceptance is still pending.

## Verification

- **17 focused checks passed**, `/tmp/gabs-profile-authority-focused-final.log`.
- Strict root/environment types, dependency/copy checks and **four fresh builds passed**, `/tmp/gabs-profile-authority-build-final.log`. Final fixture type checks also passed in `/tmp/gabs-profile-authority-types-final.log`.
- **Ten headless browser journeys passed**, `/tmp/gabs-profile-authority-web-final.log`, including the three profile cases, existing offline-policy/revocation cases, selected lists, custom SDK cached reads, reference downloads and standalone device consent. The isolated database was removed.
- **656 isolated unit/PostgreSQL tests in 96 files passed**, `/tmp/gabs-profile-authority-regression-final.log`, after the final identity-ordering changes. The isolated database was removed.

### Acceptance coverage

- `tests/unit/client-identity.test.ts` covers expected-actor transport, old-profile replies, missing actor evidence, out-of-order identity replies, duplicate/foreign invalidations, public connection probes and first identity confirmation while a restored-profile request is pending.
- `tests/unit/workspace-policy.test.ts` covers account-wide expiry across two workspaces, isolation from another account, stale policy requests/writes, fresh authorization and retained drafts, alongside the existing workspace-generation tests.
- The real PostgreSQL/API case sends a valid authenticated cookie with a different expected actor, asserts `PROFILE_CHANGED`, checks that no product was created and verifies matching-profile bootstrap and CORS evidence.
- Three new headless profile journeys use actual sessions, invitation acceptance, module assignment, Contacts capture, IndexedDB persistence and server execution. Changed cookies cannot submit the old account's work as the new account. A held old-account bootstrap in another tab cannot restore authority after account invalidation; that tab cannot obtain identity updates over HTTP. The original account can subsequently recover the original journal ID.
- Expired credentials hide corporate data and preserve the exact journal through offline restart and reauthentication. A separate cold-start case confirms denial expires remembered offline access even before the client has an in-memory identity.
- Inspected [wide](locked-wide.png) and [narrow](locked-narrow.png) profile-lock captures, with a narrow overflow check. This is scoped functional presentation evidence, not final UI approval or whole-product accessibility certification.

Initial browser assertions incorrectly expected the phone in table columns, a sign-in screen in an HTTP-isolated tab and a Cancel button in the existing editor. The fixture now checks the actual Phone field, offline lock state and Close dialog action. Reconnection can confirm identity before sending an old-profile request, and authoritative long-poll policy delivery can cancel a concurrent bootstrap. The fixtures now assert server rejection directly and observe authenticated authority through either real policy endpoint, retaining the same data-isolation, permission-revocation and exact-request checks.

Review also corrected first-identity ordering: confirming the same remembered actor does not invalidate an already-running request for that actor, while a different first identity does. Late identity persistence rechecks both cancellation and the current account; superseded replies do not count as fresh credential denials. The final browser run includes these corrections.

## Required follow-up

macOS reports `screen_locked: true`; no foreground window, unlock attempt or protected-storage fallback was used. Desktop account switching, native credential refresh persistence and protected process-restart recovery remain unverified. Passing builds and transport/unit checks do not close that gate.

Explicit sign-out still invokes the existing destructive account purge. Its preservation/recovery workflow, profile removal and the remaining workspace/release transitions are still required under OFF-03/OFF-02-LEASES. This milestone covers received credential loss and account changes, not completion of all profile lifecycle paths. API and clients must be rolled out compatibly because bound clients require authenticated actor response evidence. No deployment, release publication or whole-parity completion is claimed.
