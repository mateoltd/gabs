# Native authentication ownership

19 September 2026. **OFF-03-CREDENTIALS**, contributing to **OFF-03-SIGNOUT**, **CORE-003, SHELL-001, AUTH-002**. Engineering tests pass; real-provider and protected native acceptance remain required.

## Corrections

The main process previously used the same refresh-token fallback for both token renewal and a fresh login. If a new account's login response omitted a refresh token, it could retain the earlier account's refresh credential. Refresh deduplication also used an unscoped shared promise, whose completion could interfere with a replacement session. The loopback timeout closed the listener but did not invalidate an already-running exchange.

Production logic now lives in three focused main-process identity files:

- `credentials.ts` owns generation checks, serialized persistence/removal and one refresh flight per generation. Login replaces the refresh token; renewal may retain its same-session token when the provider omits a rotation. Memory receives new access credentials only after the storage adapter succeeds and currency is rechecked. Logout clears memory immediately and queues removal after earlier writes.
- `sign-in.ts` owns one concurrent sign-in request. Cancellation detaches it before a replacement starts; old completion cannot detach the replacement. A cancelled request cannot begin queued setup.
- `callback.ts` owns the actual registered loopback listener, timeout and cancellation. Wrong/duplicate state is refused, only one valid callback exchanges credentials, and cancelled work cannot report success. The listener closes and its port can serve the next attempt.

The main process binds these components to existing protected storage, OIDC exchange, API account verification and identity invalidation. A new sign-in clears the previous online credential/remembered entry and expires its remembered account lease while retaining business caches and pending work. Failed current sign-in clears its credentials; obsolete failures leave newer sessions alone. The renderer receives no tokens. No UI source or stylesheet changed.

## Verification

- `/tmp/gabs-native-auth-focused-final.log`: **12 focused cases across two files** pass. Credential tests cover coalescing, rotation/restart, a new account without a refresh token, old/new concurrent refreshes, held disk writes through logout, storage failure, aborted commits and cancelled sign-in replacement.
- Listener tests open real HTTP listeners on `127.0.0.1`, send real invalid/concurrent callbacks, hold exchange completion through timeout/sign-out, verify no late activation, rebind the same port, and exercise browser-launch failure. Provider exchange and protected storage are controlled test adapters; no real provider/browser is opened.
- `/tmp/gabs-native-auth-build-final.log`: strict root/browser/Node/preload/worker types, architecture/copy checks and **four build tasks** pass. The desktop bundle rebuilt; three unchanged tasks used cache. Existing bundle-size warnings remain.
- `/tmp/gabs-native-auth-regression.log`: **679 tests across 100 files** pass against an isolated PostgreSQL database, subsequently removed.

## Remaining gates

The read-only macOS signal remains `CGSSessionScreenIsLocked = Yes`. Real minimized native login, protected credential rotation/removal failure, process restart, provider denial/cancellation, MFA and refresh-token rotation still require provider/OS-backed acceptance. The controlled tests do not establish those outcomes, nor do callback cancellation checks prove remote token revocation. The existing revocation request remains best effort.

No OS unlock, protected-storage bypass, foreground window, live provider action or release publication was performed. Multiple saved corporate profiles, background privacy and broader identity recovery remain unfinished. Full parity and the separate later UI-refinement goal remain open.
