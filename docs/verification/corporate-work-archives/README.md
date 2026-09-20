# Encrypted corporate saved-work archives

Scope: **ID-03-BACKUP-ARCHIVE**, under ID-03-BACKUP-CORPORATE. Status: **active**. The portable format and atomic admission foundation are implemented; product export/import and actual file-portability acceptance remain required.

## Implemented boundary

`packages/client/src/recovery/archive` owns a versioned portable payload, authenticated encryption and explicit source collection. Collection accepts selected requests, drafts and retained copies, snapshots the source before asynchronous verification and deduplicates identical input. Draft and command review provenance stays in the existing saved-work format. A retained copy contributes its input only; its local promotion receipt does not cross devices. Missing, changed or unavailable selections fail rather than being silently omitted. The host must authorize every selected copy before displaying or exporting it. This foundation does not introduce a production-facing archive action.

The payload contains account/workspace identity, an untrusted creation timestamp and up to 256 saved-work copies within 16 MiB. Each copy retains the existing 1 MiB validation/depth limit. Credentials, leases, policy snapshots, downloaded pages, signed-contract stores and installation state are not payload fields. Business input itself remains intact. Encryption does not establish current corporate access.

The encrypted JSON envelope uses AES-256-GCM with a fresh 96-bit IV, 128-bit authentication tag and random 128-bit salt. PBKDF2-SHA256 uses the fixed format-version cost of 600,000 iterations and a nonextractable key. The header is authenticated as canonical additional data; account/workspace identity and business input are inside the ciphertext. Parameters, encoding and total bytes are bounded before key derivation. The whole ciphertext authenticates before payload parsing. Passphrases are 12–1,024 characters. Access guards run before and after asynchronous cryptography. Mutable secret/plaintext byte buffers are cleared best-effort; this does not promise JavaScript memory erasure.

The format follows the standard [Web Crypto AES-GCM parameter contract](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams) and [key derivation API](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey). An independent Node cipher test checks the declared format, including authenticated metadata. File-version parameters are not caller-selectable.

`recovery/import/admit.ts` is the shared owner of single-copy and selected-batch admission. Up to 32 selected copies enter the existing 1 MiB inert import store in one durable write. Every selected copy gets current account-bound recovery-session, permission and signed-contract checks. Multi-copy admission refreshes earlier policy observations before commit. Failed authority, capacity or storage checks admit none of the new selection; exact replay preserves existing copies and promotion metadata. Imported journals, receipts, credentials and leases never become executable or authoritative through admission. Existing explicit promotion still obtains the original outcome from the server.

The archive capacity is deliberately separate from admission capacity: an archive can retain more work than the current device can admit at once. The pending interface must expose explicit selection and keep the original file available for subsequent batches; it must not silently truncate the archive or increase the bounded import store.

## Verification

Focused format/recovery tests passed 111 cases across three files before the independent Node interoperability and larger-archive tests were added. Ten real-server/PostgreSQL import cases passed, including encrypted batch admission, current original-outcome settlement and expired-session rejection after successful decryption. The first collection test exposed propagation of unrelated runtime scope properties; collection now captures only account/workspace identifiers. Initial typecheck failures were corrected before these passes.

Final verification:

- **956 unit/PostgreSQL tests across 122 files passed**, `/tmp/gabs-archive-foundation-regression.log`.
- Strict checks and **four fresh builds passed**, `/tmp/gabs-archive-foundation-types.log`, `/tmp/gabs-archive-foundation-lint.log`, `/tmp/gabs-archive-foundation-build.log`.
- **Three headless browser and three hidden/minimized native recovery journeys passed**, `/tmp/gabs-archive-foundation-web.log`, `/tmp/gabs-archive-foundation-native.log`. These exercise existing single-file import and retained command snapshots after the shared admission refactor; they are not archive product acceptance.
- Final strict checks and scoped formatting passed after deriving the archive type from its runtime schema instead of duplicating its fields: `/tmp/gabs-archive-foundation-final-types.log`, `/tmp/gabs-archive-foundation-final-lint.log`, `/tmp/gabs-archive-foundation-format.log`. This last type-only cleanup changes no emitted runtime behavior.
- Disposable databases and device profiles were removed. Existing screenshot evidence was retained instead of committing UUID-only rerun changes. No shell/UI, CSS, native IPC or signed-release bytes changed. Native OS protection and authentication remain controlled fixtures.

No archive UI, native archive IPC or product file-portability acceptance is claimed by these foundation tests.

## Required next work

- Connect explicit archive selection, passphrase creation/unlock and additive admission to existing Settings/recovery controls. Hide unauthorized contents, clear decrypted view state on scope/lock/policy transitions, and retain raw files without copied authority.
- Authorize export online and offline under the existing valid lease rules. Recheck source release, current permissions, profile/workspace and consent before file delivery. Support retained inputs whose original contracts need recovery verification.
- Add a narrow typed desktop archive capability. Main must independently authorize each selected input, encrypt/save with current lifecycle checks and preserve files on cancellation/failure; generic renderer file writes stay disabled.
- Verify actual browser/browser, browser/desktop, desktop/browser and independently keyed desktop/desktop archive files, interrupted admission, wrong passphrases, tampering, capacity selection, expired/revoked access, restart and duplicate-safe authoritative settlement.
- Inspect the real wide/narrow interface and preserve the existing UI system. Keep browser tests headless and native tests hidden/minimized.

The broader corporate recovery graphs/transitions, corporate key loss, actual OS/identity providers and signed-platform durability remain parent gates. Overall parity and later UI refinement remain open.
