# Native standalone vaults, 20 September 2026

Scope: ID-03-LOCAL under ID-03 and SEC-002. Desktop standalone profiles now use the page-encrypted utility database and keep vault keys out of the renderer. This does not complete key rotation, lost-key recovery, physical biometric acceptance, signed releases or overall parity.

## Ownership and compatibility

- `packages/client/src/identity/local-vault` separates portable lifecycle/cryptography, persistence contracts, browser storage and the typed desktop protocol. The local module runtime consumes an opaque access contract; composition selects the provider. Shell components own presentation, without cryptographic key access.
- `apps/desktop/src/utility/storage` owns desktop envelopes and revocable, revision-bound grants. Electron main owns OS protection and trusted-sender IPC validation. The preload exposes named vault operations, not raw keys, SQL or arbitrary filesystem access.
- Browser profiles keep the existing IndexedDB format. Desktop imports preserve the original passphrase ciphertext and PIN policy. Envelopes and digest receipts commit together; exact replay acknowledges migration without replacing newer native work. Conditional IndexedDB cleanup removes only the acknowledged, unchanged source. Failure or conflicting source data retains the original.
- Session identities distinguish utility processes. Observed change generations reject unlock replies overtaken by revocation. Retired process replies cannot re-open access or invalidate a newer session. Utility exit, OS lock/suspend and renderer teardown revoke native grants. Clearing references is not a promise of guaranteed JavaScript memory erasure.
- The outer desktop database requires its OS-protected master key even when a profile is unlocked by passphrase. There is no plaintext fallback. Passphrase recovery cannot replace a missing database key; durable key rotation and backup/recovery remain required.

## Acceptance scope

Automated native PIN tests use an explicitly controlled OS adapter inside test code. They exercise the actual renderer, preload, main, utility process, encryption and SQLite persistence, but do not establish Keychain/DPAPI/secret-service or physical biometric acceptance. The prepared-provider journey remains separately opt-in. No production protection bypass was added.

The packaged-worker check uses an ephemeral key and a real unsigned macOS arm64 ASAR. It verifies native driver loading and corporate/standalone persistence through forced process termination. It does not verify an installed signed application, production main, notarization, updates or Windows/Linux execution.

## Review

Checkpoint `f40229a` and tag `checkpoint/architecture-native-vault-2026-09-20` preserve the unfinished implementation. The user-requested Sol xhigh review and independent parent review retain the existing directory migration and address the concrete session-ordering hazards. No styles, design tokens, public package identities or signed module artifacts change.

## Verification

- 28 focused tests across four files passed in `/tmp/gabs-native-architecture-focused.log`: portable browser PIN behavior, stale generation/process replies, termination invalidation, failed/incomplete migration acknowledgement, utility grants and encrypted persistence, cache retention and architecture boundaries.
- Strict root/browser/Node/preload/worker type checks, boundary/copy checks and all four fresh application builds passed in `/tmp/gabs-native-architecture-build-final.log`. The initial strict run caught an overly narrow inferred UUID parameter type; an explicit string annotation fixes the validated boundary. Existing bundle-size warnings remain.
- The full isolated unit/PostgreSQL regression passed **744 tests across 111 files** in `/tmp/gabs-native-architecture-regression.log`. The disposable database was removed.

- Eight selected headless browser journeys passed in `/tmp/gabs-native-architecture-web.log`: local PIN/offline restart, enrollment cancellation, cross-tab locking, delayed create/unlock cleanup, concurrent restoration, encrypted worker receipts and stale writers.
- Three minimized desktop journeys each passed twice, **six passes**, in `/tmp/gabs-native-architecture-desktop.log`: fail-closed unavailable protection, PIN/application restart with utility-owned storage, synthetic OS lock, actual utility SIGKILL revocation, legacy migration replay and delayed PIN-enrollment cancellation. The initial checkpoint baseline also passed three journeys before the additional lifecycle fix. No foreground window or OS prompt was opened.
- Native settings, narrow browser settings and browser restoration captures were inspected. Existing layouts, feedback and controls remain intact; overwritten historical captures were restored. [Current native settings](settings.png) is scoped regression evidence, not approval of final UI design.
- Changed-source Prettier checks and `git diff --check` pass. Original requirement mappings remain intact. Actual OS-provider, biometric and broader release gates remain open.
- Fresh unsigned macOS arm64 packaging passed in `/tmp/gabs-native-architecture-package.log`. The actual packaged ASAR worker passed `/tmp/gabs-native-architecture-packaged-worker.log`: corporate pending data and a standalone committed record survived SIGKILL/restart; returned grants contained no key and disk metadata/content remained encrypted. The app stayed hidden/minimized. All disposable acceptance databases were removed.
