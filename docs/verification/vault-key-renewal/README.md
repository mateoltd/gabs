# Standalone quick-unlock envelope renewal

20 September 2026. Scope: ID-03-UNLOCK-WRAP under ID-03 and SEC-002/AUTH-002. A successful native PIN or biometric unlock now renews both stored OS-protected envelopes together when their provider requests renewal. Database master/page-key rotation and backup/lost-key recovery remain separate unfinished work.

## Implementation

- `NativeLocalUnlock` validates the envelope's version, profile, credential epoch, purpose and payload before opening or renewing it. Its private provider now retains the `shouldReEncrypt` result instead of discarding it. Renewal returns ciphertext only and preserves the credential; opening a biometric envelope still requires its normal authorization prompt.
- The main/utility protection protocol adds a typed `renew` operation. This capability is not exposed by the renderer preload or the public renderer vault-operation registry. Desktop keys remain in main/utility custody.
- After PIN/biometric validation and authenticated vault decryption, the utility-owned quick-unlock engine renews both the PIN and optional biometric envelope. Both replacements and reset retry counters commit in one vault update before an unlock grant is issued. The credential epoch, vault key, business ciphertext and business revision remain unchanged.
- Wrong PINs do not initiate renewal. Failed provider renewal, cancellation, profile removal and intervening business edits cannot commit stale replacements. Failure renewing the second envelope cannot leave only the first replacement committed. Failed attempts retain their durable counters; a successful retry resets them.
- Renewal of the unused biometric envelope does not prompt or release a biometric key. It rewraps an existing validated ciphertext with the same bound content. Later biometric access still requires its own prompt. This distinction avoids repeatedly asking for both unlock methods just to renew OS encryption.
- Browser-only vaults retain their existing encrypted PIN behavior. Passphrase recovery remains available. If an old provider key is already unavailable before renewal, the app cannot invent its plaintext: passphrase-based quick-unlock reset and broader key-recovery work remain relevant.

The envelope contract follows the existing [Electron safeStorage renewal signal](https://www.electronjs.org/docs/latest/api/safe-storage). Renewal is performed on successful quick unlock; this is not an unattended scan of every unused profile before a provider retires keys.

## Acceptance

- `/tmp/gabs-vault-renewal-focused.log` passed 21 focused tests across native protection, the real encrypted vault store and browser vault behavior. This run preceded one additional boundary test, included in the final regression: ciphertext renewal cannot replace biometric authorization, and foreign profile/epoch/purpose bindings are rejected.
- Controlled AES-GCM providers verify both unlock methods, simultaneous renewal of the used and unused envelope, old-provider-key retirement, database restart, unchanged business ciphertext/revision, passphrase fallback, wrong PINs, failure on the second renewal, cancellation, removal and a concurrent business edit. Controlled callbacks are not actual hardware acceptance.
- `/tmp/gabs-vault-renewal-build.log` passed strict root/browser/Node/preload/worker checks, architecture/copy checks and four fresh application builds. Existing bundle-size warnings remain.
- `/tmp/gabs-vault-renewal-native.log` passed six hidden/minimized journeys. Three real app restart journeys cover passphrase, PIN and biometric access after two provider generations and old-key retirement. The PIN and biometric journeys also unlock using the other method after retirement. Existing unavailable-protection, utility-crash, migration and cancellation journeys pass. Native biometric/provider callbacks are explicitly controlled in test code; no physical Touch ID prompt or foreground window is opened. The disposable acceptance database was removed.

No UI source, styles, package identities or runtime renderer capabilities changed. Physical provider rotation/biometric acceptance, database master/page-key rotation, backup/recovery and signed target-platform acceptance remain required. Overall parity and the later UI-refinement goal remain open.

Final-source verification passed **760 unit/PostgreSQL tests across 112 files** in `/tmp/gabs-vault-renewal-regression.log`. Both headless browser PIN journeys passed in `/tmp/gabs-vault-renewal-web.log`, preserving offline restart, passphrase recovery, cross-tab locking and cancelled enrollment. Disposable databases were removed. Changed-source formatting, `git diff --check`, documentation links and original requirement mappings pass.
