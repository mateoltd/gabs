# Scoped revocation recovery

19 September 2026. Tracker: **OFF-02-LEASES-REVOKE**, within active **OFF-02-LEASES/OFF-02**. Original coverage: **CORE-003/SHELL-001**. Native and broader account/context acceptance remain required.

## Changes

`WorkspacePolicy` owns snapshot reconciliation and an account/workspace authorization generation under the existing storage lock. Bootstrap and long-poll requests capture that generation before transport. Received denial changes the generation, immediately invalidates local callbacks and persists a denied marker before expiring the snapshot. Replies and writers from the old generation cannot restore access, even after a later reauthentication. Tickets carry their account/workspace and local epoch; foreign-scope tickets and mismatched stored snapshots fail closed.

The snapshot remains present, expired, retaining the device's offline preference. Pending journals/drafts stay intact. Fresh online authorization can restore access and synchronize eligible original requests; observing a policy through an already-open recovery action cannot independently clear denial. A persisted denied marker still locks a snapshot when interruption prevented its expiry write. A scoped broadcast hides retained surfaces in another same-origin tab that cannot receive HTTP policy updates. No broadcast grants access.

The shell shows a locked state with a real revalidation action. Existing record/draft UI remains preserved behind the hidden surface. Policy state/persistence is separated from the React long-poll hook. Session-only online use does not create a snapshot or require a new protected-storage write. The desktop cache whitelist admits only the new scoped authority record through its existing sender, identity and protected-storage checks; no privilege or storage bypass was added.

## Verification

- **Nine focused checks**, `/tmp/gabs-policy-revocation-focused.log`, cover ordered policy revisions, old-generation replies/writes, first-write/denial overlap, interrupted expiry persistence, fresh reauthentication, retained work, shortened/disabled leases, session-only use, actual scoped broadcasts and foreign ticket/snapshot rejection.
- **646 isolated unit/PostgreSQL tests in 95 files passed**, `/tmp/gabs-policy-revocation-regression-final.log`. The helper removed its database.
- Strict root/environment types, dependency/copy checks and **four fresh builds passed**, `/tmp/gabs-policy-revocation-build-final.log`.
- **Six headless journeys passed**, `/tmp/gabs-policy-revocation-web-final.log`: membership revoke/regrant, disabled-policy recovery, shortened-window expiry, selected offline lists, public SDK cached reads and reference downloads. The helper removed its database.
- The new browser journey creates a second owner through real invitation/acceptance APIs, opens a second tab, then blocks that tab's HTTP API traffic. The original tab captures a real Contacts edit offline. The second owner revokes membership through the normal member API. Reconnecting expires the snapshot, locks the HTTP-isolated tab and preserves the exact original journal. Offline restart remains locked. Restored membership reopens device recovery and the original request receives authoritative acceptance with its original identity/input/dependencies.
- Narrow overflow checks and inspected [wide](locked-wide.png) and [narrow](locked-narrow.png) lock-state captures. The unchanged dialog journeys retain their scoped Axe checks. This is functional presentation evidence, not final design approval or whole-product accessibility certification.

Initial test setup selected the administrator role instead of Owner; the real ownership guard correctly rejected removing an owner. The fixture now explicitly invites another Owner. A focused wrong-snapshot test also caught an unguarded loader path; all snapshot reads now use the scoped loader before final acceptance.

## Required follow-up

The macOS console still reports `screen_locked: true`. Protected native storage, IPC and process-restart acceptance for the new authority record remain unverified; builds do not establish this acceptance. No unlock attempt, plaintext fallback or foreground desktop test was used.

Request-generation unit checks do not prove every browser/network race. Account-wide session expiry, cookie/profile changes during pending responses, remaining workspace/release transitions and explicit sign-out/profile-removal recovery still require implementation or acceptance under OFF-02-LEASES and OFF-03. In particular, local ticket scope alone does not bind a server response to an identity when shared browser credentials change. No entire original requirement or the full parity goal is complete.
