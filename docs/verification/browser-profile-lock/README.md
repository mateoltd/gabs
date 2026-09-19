# Browser profile locking

Tracker: ID-02-BROWSER, under ID-02. Status: local foundation and corporate browser product acceptance verified; actual provider recovery, standalone PIN/biometric integration and native hardware/storage acceptance remain open.

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

## Remaining work at the foundation checkpoint

- Connect the adapter to corporate account selection, API dispatch/results, cache reads/writes, capabilities and synchronization. Preserve uncertain request identities and pending work when locking interrupts a response.
- Adapt the existing shared lock/settings UI and account-menu command without changing its styling. Preserve same-account editors and hide corporate feedback while locked.
- Persist and validate recovery challenges through OIDC redirects; recover before protected session queries resume. Exercise account replacement, logout, lost notifications, policy changes and interrupted recovery in the real interface.
- Verify browser offline/reload/expiry flows end to end. Real-provider MFA/recovery, native protected-storage/biometric acceptance and standalone PIN integration remain separate required gates.

At the foundation checkpoint, no product UI, styles or Electron source changed. No desktop window or native biometric prompt was opened. ID-02 and overall parity remain incomplete; the later UI-refinement goal has not begun.

## Corporate product integration, 20 September 2026

The browser now uses the shared device-unlock settings and lock screen. Corporate requests use client access hooks before dispatch and before exposing responses; scoped clients inherit those hooks. Short cache operations, identity writes, exports and notifications also check the active account and current durable policy. Identity discovery and sign-out retain their narrow control paths. A lock does not turn an uncertain server request into a rejection or delete its saved identity.

Recovery intent survives navigation in session storage. The existing sign-in interface captures a new challenge immediately before authentication. Recovery validates current server evidence and adopts the new session credentials while the corporate surface is still locked, then rechecks the policy before granting access. Starting another sign-in supersedes an older recovery. Redirect completion cannot unlock with the original session.

The browser preserves its session controller through local locking and sign-out. Account-scoped workspace feedback resets when the account changes; native surface ownership remains unchanged. Provider-account mismatches are rejected before switching the visible profile. Existing classes and styles are reused; no stylesheet changed.

### Product evidence

[Headless product journeys](../../../tests/e2e/browser-profile-lock.spec.ts) exercise PIN setup, incorrect PIN handling, preservation of an unsaved settings field, offline pending work across reload, expired offline leases, fresh authentication and explicit PIN reset, redirect continuity, cross-tab locking and independent unlock grants. Another journey holds an actual accepted server mutation reply while locking, then verifies recovery with the same request and an authoritative record version of 2, proving no duplicate update.

The redirect fixture uses the real development session issuer and recovery endpoint with controlled navigation. It does not establish real-provider OIDC/MFA acceptance. The [actual shell access-boundary test](../../../tests/unit/browser-profile-access.test.ts) bundles the production runtime in headless Chromium: a held response cannot cross a lock, locked scoped requests never dispatch, cache access and destructive operations fail, and unlocking recovers unchanged data. Server responses in this boundary harness are controlled; the product mutation test above uses the actual API and PostgreSQL.

An initial browser run exposed a sign-out/profile-surface lifetime regression. Two subsequent diagnostic reruns reused the earlier preview bundle and supply no evidence for their source changes. After an explicit rebuild, the browser keeps the session controller mounted and isolates workspace feedback by account; existing saved-account and provider-mismatch journeys pass. Future browser checks must build before relying on an already running preview server.

### Final verification and limits

- Final source passed 719 unit/PostgreSQL tests across 107 files. The suite includes 12 engine cases, two real-browser storage cases and the actual shell access-boundary case. The isolated database was removed.
- Strict root/browser/Node/preload/worker checks, boundary/copy checks and all four fresh application builds passed.
- All 17 headless browser journeys passed: five browser-lock product journeys plus saved profiles, provider mismatch, profile authority, sign-out recovery and background privacy. PIN unlock leaves the original lease expiry unchanged; an expired lease still prevents workspace access.
- Three hidden/minimized, unfocused Electron journeys passed: background privacy, storage readiness and corrupt-policy recovery. Actual OS-protected PIN/restart remains skipped while protected storage is unavailable. No test invoked Touch ID or unlocked the OS.
- Current [wide lock screen](locked-wide.png), [narrow lock screen](locked-narrow.png) and [settings](settings-wide.png) captures were inspected. The narrow lock screen has no horizontal overflow. Current native captures are retained separately: [lock](native-locked.png), [settings](native-settings.png) and [readiness](native-readiness.png). Historical captures were restored.

The browser implementation uses actual IndexedDB and WebCrypto, and the product journeys use the actual development API/database. Development sessions and controlled redirects do not prove a real identity provider's MFA/OIDC recovery behavior. Production-provider acceptance remains required. Browser cache encryption, hostile same-origin code protection, standalone PIN/biometric integration and native hardware/storage acceptance are not established by this milestone. Existing visual styles remain unchanged; this is not final UI design approval.

Integration logs: `/tmp/gabs-browser-lock-integration-focused.log`, `/tmp/gabs-browser-lock-integration-build.log`, `/tmp/gabs-browser-lock-integration-browser.log`, `/tmp/gabs-browser-lock-switch-fix.log`, `/tmp/gabs-browser-lock-switch-debug.log`, `/tmp/gabs-browser-lock-integration-browser-verified.log`, `/tmp/gabs-browser-lock-integration-extended.log`, `/tmp/gabs-browser-lock-integration-uncertain.log`, `/tmp/gabs-browser-lock-integration-final-build.log`, `/tmp/gabs-browser-lock-integration-final-regression.log`, `/tmp/gabs-browser-lock-integration-final-browser.log` and `/tmp/gabs-browser-lock-integration-native.log`.

ID-02 remains active. The next independent engineering item is ID-02-LOCAL; full parity and the later UI-refinement goal remain open.
