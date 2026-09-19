# Browser profile-lock foundation

Tracker: ID-02-BROWSER, under ID-02. Status: foundation verified locally; product integration and acceptance remain open.

## Implementation

- The [portable engine](../../../packages/client/src/identity/browser-profile-lock.ts) implements the shared profile-lock contract. It stores a random salt and an account-bound HMAC verifier derived with WebCrypto PBKDF2, never the PIN. Failure counts and bounded retry delays are durable.
- The [browser adapter](../../../packages/client/src/adapters/browser-profile-lock.ts) stores serialized policies in origin-scoped IndexedDB. Web Locks serialize mutations across tabs; BroadcastChannel invalidates their visible state. Each tab keeps its unlock grant only in memory. Reloading requires unlocking again.
- Durable policy epochs fence work started before locking or changing accounts. The `access` guard requires the active account and rechecks storage before a caller returns data or publishes a result. A missed broadcast cannot bypass that final check. These guards must still be wired into corporate request/cache paths.
- Fresh recovery uses the actual typed server endpoint. A recovery challenge binds the expected account, policy snapshot, start time and previous session identity. Same-session, foreign-account, expired and changed-policy completions fail. Reset authority expires after the server's five-minute window.
- Locking never overwrites unreadable settings. Explicit fresh recovery preserves an unreadable serialized policy inside a fault record until the user resets it. A failed storage read locks access and cannot manufacture recovery evidence. Unsupported non-string store values require browser-profile restoration; they are not silently deleted.

This is a cooperative browser access gate, not encryption of corporate caches or protection against hostile same-origin code, developer tools, profile-file editing or a compromised OS. Unlocking does not renew offline leases or grant server permissions. Standalone personal profiles retain their separate protection.

## Verification

- Ten [engine tests](../../../tests/unit/browser-profile-lock.test.ts) use actual WebCrypto. They cover reloads, copied account policies, concurrent failed attempts, durable retry delays, missed broadcasts, stale reads/account replacement, locking during the first policy write, corrupt/future policies, recovery replay, expiry and storage failures. An unchanged fault reread does not cancel pending fresh recovery, while an explicit lock does.
- Two [real-browser adapter tests](../../../tests/unit/browser-profile-lock-storage.test.ts) run headless Chromium with actual IndexedDB, Web Locks and BroadcastChannel. They verify independent-tab locking, observer notification, reload persistence, concurrent attempts and offline recovery refusal. They do not mock browser storage or PIN derivation. The test page is an adapter harness, not the product interface.
- The first strict check found a generic `navigator.locks.request` return-type mismatch. An awaited async adapter resolved it. Strict root/browser/Node/preload/worker checks, architecture/copy checks and all four fresh application builds subsequently passed. The corrected cross-tab test observes the notification directly instead of refreshing status itself. A final review reproduced cancellation from an unchanged fault reread; the regression failed before idempotent fault handling and passed afterward. All twelve focused tests passed on the corrected source.

- Final-source isolated regression passed all 716 tests across 106 files; the disposable PostgreSQL database was removed. Strict environment/boundary/copy checks and all four fresh builds also passed on the final source. An earlier 714-test run passed before the two fault-refresh regressions were added; it is not substituted for the final run. All 29 original requirement IDs remain present and unchanged.

Logs: `/tmp/gabs-browser-lock-unit.log`, `/tmp/gabs-browser-lock-storage.log`, `/tmp/gabs-browser-lock-types.log`, `/tmp/gabs-browser-lock-build.log`, `/tmp/gabs-browser-lock-final-build.log`, `/tmp/gabs-browser-lock-final-focused.log` and `/tmp/gabs-browser-lock-regression.log`, `/tmp/gabs-browser-lock-final-regression.log` and `/tmp/gabs-browser-lock-refresh-before.log`. Committed fixtures and this record are the durable evidence.

## Remaining work

- Connect the adapter to corporate account selection, API dispatch/results, cache reads/writes, capabilities and synchronization. Preserve uncertain request identities and pending work when locking interrupts a response.
- Adapt the existing shared lock/settings UI and account-menu command without changing its styling. Preserve same-account editors and hide corporate feedback while locked.
- Persist and validate recovery challenges through OIDC redirects; recover before protected session queries resume. Exercise account replacement, logout, lost notifications, policy changes and interrupted recovery in the real interface.
- Verify browser offline/reload/expiry flows end to end. Real-provider MFA/recovery, native protected-storage/biometric acceptance and standalone PIN integration remain separate required gates.

No product UI, styles or Electron source changed in this milestone. No desktop window or native biometric prompt was opened. ID-02 and overall parity remain incomplete; the later UI-refinement goal has not begun.
