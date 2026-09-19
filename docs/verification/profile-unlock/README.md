# Native profile unlock and architecture review

Tracker: ID-02-NATIVE, under ID-02. Status: implementation and scoped local acceptance; real protected-storage, biometric and provider acceptance remain required.

## Ownership and behavior

Checkpoint `be100d1` and tag `checkpoint/architecture-unlock-be100d1` preserve the unfinished checkout. The explicitly requested Sol agent at xhigh reviewed the implementation; the parent reviewed the resulting diff and added adversarial tests. The earlier physical migration already supplies `sdk`, `client`, `server`, `shell` and `ui/web`. This pass keeps those boundaries and existing public package identifiers.

- [Portable bridge and status](../../../packages/client/src/identity/profile-lock.ts) belong to client identity. The root bridge composes and re-exports the contract for compatibility.
- [Native policy](../../../apps/desktop/src/main/identity/profile-lock.ts) belongs to Electron main. Policies are scoped by account and API origin and require actual OS-protected storage. An 8–12 digit PIN uses a random salt and scrypt verifier. Failure counts and bounded retry delays persist. Optional supported Touch ID requires explicit opt-in and a successful native prompt.
- [Gate and settings](../../../packages/shell/src/features/identity/profile-lock.tsx) belong to shell identity. Same-account locking preserves the editor; account replacement clears query state and remounts the account subtree. Corporate feedback portals belong to that subtree. Recovery sign-in and standalone profiles have separate feedback providers.
- Privileged native calls and cached reads require an unlocked profile. Lock/suspend invalidates outstanding response ownership and native capabilities, and cancels the whole pending sign-in attempt, including a provider callback. Fresh online authentication can recover access, with an explicitly expiring five-minute reset window. Server permissions and offline leases still apply.
- A local lock response is not an authoritative business rejection. The SDK retains an uncertain request and its original retry identity, and stops the current synchronization pass until access returns.

Parent review reproduced a first-enable race: the policy reached disk after locking, while the running gate remained unlocked. Pending mutations now fail closed, and committed same-account policy state is reconciled before stale callers are rejected. A second regression checks that relocking cannot discard a newly persisted retry delay. Startup restores remembered identity independently of refresh-token recovery, so one damaged credential does not suppress another valid recovery source.

## Verification

Final verification on the reviewed source:

- 40 focused tests passed: 14 architecture fixtures, nine native policy tests and 17 journal delivery tests. The new first-policy-write race failed before the correction and passed afterward.
- Strict root/browser/Node/preload/worker type checks and boundary/copy checks passed. The first build produced four fresh successful targets. The final read-generation and sign-in cancellation corrections each rebuilt desktop and reused three valid unchanged build targets. The final cancellation/policy/journal selection passed 35 tests, including both sign-out and profile-lock cancellation reasons.
- The final isolated unit/PostgreSQL suite passed all 699 tests across 102 files in 85 seconds. An earlier uninterrupted rerun passed all 698 tests before the additional sign-in cancellation case. The first run passed 695 and timed out in three tests during recorded macOS sleep/wake intervals, including a 321-second maintenance sleep. Those three files passed all 12 cases in 1.57 seconds with unchanged timeout limits, followed by the clean full rerun. Disposable databases were removed.
- All 12 headless browser journeys passed: background privacy, saved-account selection, profile authority and sign-out recovery.
- Three hidden/minimized, unfocused Electron journeys passed: background renderer privacy, protected-storage readiness and corrupt-policy recovery. The fourth, actual protected-storage PIN/restart journey, remains skipped. The readiness capture was repeated after dismissing its transient notification. All three native journeys passed again after the final sign-in cancellation correction, with the same protected-storage skip.
- Captures were inspected: [locked screen](native-locked.png), [device unlock settings](native-settings.png) and [settings in the shell](native-readiness.png). The locked screen contains no corporate toast or editor. Existing styles remain unchanged; this is not final UI design approval. An overwritten historical browser capture was restored.

Run logs: `/tmp/gabs-architecture-unlock-focused.log`, `/tmp/gabs-architecture-unlock-journal.log`, `/tmp/gabs-architecture-unlock-build.log`, `/tmp/gabs-architecture-unlock-final-build.log`, `/tmp/gabs-architecture-unlock-regression.log`, `/tmp/gabs-architecture-unlock-timeout-followup.log`, `/tmp/gabs-architecture-unlock-final-regression.log`, `/tmp/gabs-architecture-unlock-browser.log`, `/tmp/gabs-architecture-unlock-native.log` `/tmp/gabs-architecture-unlock-native-capture.log`, `/tmp/gabs-architecture-unlock-auth-tests.log`, `/tmp/gabs-architecture-unlock-auth-build.log`, `/tmp/gabs-architecture-unlock-auth-native.log` and `/tmp/gabs-architecture-unlock-auth-regression.log`. These are local diagnostics; the committed fixtures and this record are the durable evidence.

Native tests use the actual Electron host and development API. The unavailable-storage case refuses a volatile PIN. A deliberately corrupt policy file in a disposable profile exercises fail-closed access, fresh online recovery and retention of an unsubmitted workspace name. A controlled main-process suspend signal exercises the production listener; a separately encrypted standalone profile remains usable while corporate API access returns 423. No test unlocks macOS or invokes real Touch ID.

## Acceptance limits and next work

- The real OS-protected PIN/configuration/restart journey is skipped while macOS reports locked. In-memory test storage proves policy logic, not Keychain acceptance. Actual hardware success/cancellation, physical suspend/lock delivery and target-OS acceptance remain required.
- Development authentication does not establish real-provider MFA, OIDC callback, fresh-authentication or recovery acceptance.
- PIN gating does not re-encrypt every database field with the PIN, encrypt SQLite metadata, erase JavaScript memory or protect against a compromised OS. Full-file encryption remains ID-03.
- If a lock interrupts first configuration before persistence, the current process remains locked and requires online recovery; a restart reads the actual absent policy. A removal committed during locking also leaves the running process locked. Neither path deletes business work.
- Browser corporate local unlock and standalone PIN/biometric integration remain engineering work. Existing standalone passphrase protection is retained. ID-02, overall functionality parity and the later UI-refinement goal remain incomplete.
