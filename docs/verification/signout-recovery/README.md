# Sign-out without losing saved work

19 September 2026. Tracker: **OFF-03-SIGNOUT**, contributing to active **OFF-02-LEASES** and unfinished **OFF-03**. Original coverage: **CORE-003, SHELL-001, AUTH-002**.

## Behavior

Sign-out terminates access without purging corporate snapshots, ordinary drafts or operation journals. It invalidates the account's offline leases, clears remembered entry and locks other tabs. Reauthentication and current workspace permissions determine which saved operations can resume. Device-data deletion remains a separate action; this does not complete profile removal.

A durable sign-out record prevents an old still-valid browser cookie from silently reopening corporate access after offline sign-out. Reconnection terminates that session before any workspace opens. A SHA-256 fingerprint of its random per-session CSRF token distinguishes the old session from fresh authentication without persisting the token itself. The fingerprint survives an offline renderer restart. A different authenticated profile or a genuinely fresh session can proceed; legacy pending sign-outs retain their termination behavior.

Termination acknowledgements are separate from business authority responses: invalidating the local client immediately does not discard a successful logout acknowledgement. Failed transport leaves termination pending. Host sign-in and logout use one browser lock so a delayed logout cookie response cannot clear a newer host sign-in. The initiating window shows the existing loading component while termination runs. Other tabs hide corporate views immediately, including a tab isolated from API traffic.

Native logout now retains encrypted account business data, expires account authority and removes credentials/remembered entry. Token writes and deletion serialize; old refresh/login completions check their authentication generation before persisting credentials. Login waits for native logout cleanup. These native changes require protected-storage and real-provider acceptance below.

## Verification

- **13 focused client/session checks passed**, `/tmp/gabs-signout-unit-final.log`: held acknowledgements, immediate invalidation, offline session fingerprints, fresh-session distinction, failed termination, stale acknowledgement protection, legacy recovery and prior profile-ordering checks.
- Strict root/environment types, dependency/copy checks and **four fresh builds passed**, `/tmp/gabs-signout-build-final.log`.
- **14 headless journeys passed**, `/tmp/gabs-signout-web-final.log`; the isolated database was removed. Five new sign-out journeys cover warm/cold offline sign-out, actual old-session termination, original-request recovery, an uncertain server-accepted update, disconnected-tab lock, revoked write access and a held logout/new-login race. The three profile-authority journeys and six existing business/navigation/storage/accessibility workflows also pass.
- The uncertain-operation case aborts the real accepted update response and blocks receipt recovery, verifies durable `delivery: uncertain` through sign-out/restart, then reauthenticates and recovers the original journal ID. The server record remains at version 2, proving there was no duplicate update.
- The revocation case removes write permission while signed out. The host retains the unsubmitted pending request under the new policy, and an explicit attempt with the original key receives server `403 FORBIDDEN`; the record remains at version 1 with its original value. A held operation is not falsely labelled as a confirmed rejection before submission.
- The concurrent-session case holds an actual logout response after server execution, starts a different account's sign-in in another tab, observes that sign-in waiting on the shared lock, then releases logout and verifies the new account's cookie still authenticates.
- Inspected [wide](locked-wide.png) and [narrow](locked-narrow.png) disconnected-tab lock captures; narrow overflow check passed. Existing UI structure is preserved. This is functional presentation verification, not final UI approval or whole-product accessibility certification.
- **661 isolated unit/PostgreSQL tests in 97 files passed**, `/tmp/gabs-signout-regression-final.log`; the isolated database was removed.

The first fixture run read storage during the intentional offline reload and used an invalid GET route for module records. The fixture now awaits reload and uses the actual versioned POST list contract. Permission preflight correctly holds unsent work as pending; the test asserts that state and independently verifies server denial rather than requiring an attempted/rejected state. Earlier full profile work remains historical evidence, not a substitute for these final checks.

## Required follow-up

The macOS console still reports `screen_locked: true`. Minimized native sign-out/process-restart and protected credential-refresh race fixtures still need completion and execution. No protected-storage bypass, unlock attempt or foreground test was used. Real OIDC provider callbacks, cancellation and overlapping cross-window redirect flows remain required; unit fingerprint checks and the host-controlled browser lock do not certify provider acceptance.

Profile removal, broader saved-profile recovery and remaining workspace/release transitions stay open. Native callback cancellation and protected cleanup failure paths require continued review and acceptance. No entire original requirement, full OFF-03 or overall parity is complete.
