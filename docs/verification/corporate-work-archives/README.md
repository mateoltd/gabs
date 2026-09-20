# Encrypted corporate saved-work archives

Scope: **ID-03-BACKUP-ARCHIVE**, under ID-03-BACKUP-CORPORATE. Status: **active**. The portable format, selected export/import controls and independent native file delivery are implemented. Four-direction files and mixed-module retained reviews have acceptance evidence below. Archive-specific expiry/profile/process-interruption and multi-batch capacity remain required before this item is verified.

## Implemented boundary

`packages/client/src/recovery/archive` owns a versioned portable payload, authenticated encryption and explicit source collection. Collection accepts selected requests, drafts and retained copies, snapshots the source before asynchronous verification and deduplicates identical input. Draft and command review provenance stays in the existing saved-work format. A retained copy contributes its input only; its local promotion receipt does not cross devices. Missing, changed or unavailable selections fail rather than being silently omitted. The host must authorize every selected copy before displaying or exporting it. Settings now exposes the archive workflow described below.

The payload contains account/workspace identity, an untrusted creation timestamp and up to 256 saved-work copies within 16 MiB. Each copy retains the existing 1 MiB validation/depth limit. Credentials, leases, policy snapshots, downloaded pages, signed-contract stores and installation state are not payload fields. Business input itself remains intact. Encryption does not establish current corporate access.

The encrypted JSON envelope uses AES-256-GCM with a fresh 96-bit IV, 128-bit authentication tag and random 128-bit salt. PBKDF2-SHA256 uses the fixed format-version cost of 600,000 iterations and a nonextractable key. The header is authenticated as canonical additional data; account/workspace identity and business input are inside the ciphertext. Parameters, encoding and total bytes are bounded before key derivation. The whole ciphertext authenticates before payload parsing. Passphrases are 12–1,024 characters. Access guards run before and after asynchronous cryptography. Mutable secret/plaintext byte buffers are cleared best-effort; this does not promise JavaScript memory erasure.

The format follows the standard [Web Crypto AES-GCM parameter contract](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams) and [key derivation API](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey). An independent Node cipher test checks the declared format, including authenticated metadata. File-version parameters are not caller-selectable.

`recovery/import/admit.ts` is the shared owner of single-copy and selected-batch admission. Up to 32 selected copies enter the existing 1 MiB inert import store in one durable write. Every selected copy gets current account-bound recovery-session, permission and signed-contract checks. Multi-copy admission refreshes earlier policy observations before commit. Failed authority, capacity or storage checks admit none of the new selection; exact replay preserves existing copies and promotion metadata. Imported journals, receipts, credentials and leases never become executable or authoritative through admission. Existing explicit promotion still obtains the original outcome from the server.

The archive capacity is deliberately separate from admission capacity: an archive can retain more work than the current device can admit at once. The interface exposes explicit selection and keeps the original file available for subsequent batches; it does not silently truncate the archive or increase the bounded import store.

## Foundation verification

Focused format/recovery tests passed 111 cases across three files before the independent Node interoperability and larger-archive tests were added. Ten real-server/PostgreSQL import cases passed, including encrypted batch admission, current original-outcome settlement and expired-session rejection after successful decryption. The first collection test exposed propagation of unrelated runtime scope properties; collection now captures only account/workspace identifiers. Initial typecheck failures were corrected before these passes.

Final verification:

- **956 unit/PostgreSQL tests across 122 files passed**, `/tmp/gabs-archive-foundation-regression.log`.
- Strict checks and **four fresh builds passed**, `/tmp/gabs-archive-foundation-types.log`, `/tmp/gabs-archive-foundation-lint.log`, `/tmp/gabs-archive-foundation-build.log`.
- **Three headless browser and three hidden/minimized native recovery journeys passed**, `/tmp/gabs-archive-foundation-web.log`, `/tmp/gabs-archive-foundation-native.log`. These exercise existing single-file import and retained command snapshots after the shared admission refactor; they are not archive product acceptance.
- Final strict checks and scoped formatting passed after deriving the archive type from its runtime schema instead of duplicating its fields: `/tmp/gabs-archive-foundation-final-types.log`, `/tmp/gabs-archive-foundation-final-lint.log`, `/tmp/gabs-archive-foundation-format.log`. This last type-only cleanup changes no emitted runtime behavior.
- Disposable databases and device profiles were removed. Existing screenshot evidence was retained instead of committing UUID-only rerun changes. No shell/UI, CSS, native IPC or signed-release bytes changed. Native OS protection and authentication remain controlled fixtures.

No archive UI, native archive IPC or product file-portability acceptance is claimed by these foundation tests.

## Product workflow and boundaries

Settings offers **Saved-work archives** alongside existing saved-work recovery. Creating a file loads authorized requests, drafts and retained copies, requires explicit selection and a confirmed passphrase, and preserves source work. Opening a file authenticates its ciphertext and checks fresh account/workspace authority before displaying any input. Selection starts empty. Admission adds inert copies; the existing **Import saved work** workflow performs explicit restoration and server settlement separately.

`packages/client/src/adapters/recovery-export.ts` shares current-policy, original signed-contract and offline-lease checks with single-file export. Final guards recheck access inside browser profile-lock access and before native delivery. Scope, connectivity, consent and policy transitions clear decrypted view state. The archive surface separates orchestration in `recovery/archive/state.ts` from presentation in `index.tsx`, reusing existing host controls and styling.

The narrow typed Electron capability takes a live module-host handle, bounded plaintext payload and passphrase. Main independently authorizes every selected copy, encrypts it, reauthorizes after the save dialog, and checks all earlier copy guards before publication. One session anchors lifecycle/scope without allocating a session for every module. Ciphertext is flushed to a private temporary file and published atomically without overwriting an existing backup. Cancellation/failure cleans up the temporary file; generic renderer file writes remain disabled.

## Product acceptance, 20 September 2026

All 16 final archive captures below were visually inspected. Existing single-file and command-review regression captures are retained rather than replacing historical evidence with UUID-only rerun differences.

Actual UI-created encrypted files travel web to web, web to desktop, desktop to web and between independently keyed desktop stores. Each file contains an actual offline request and independent Contacts draft. The destination admits only the encrypted archive, rejects wrong passphrases and altered ciphertext, starts with unchecked copies, hides input on received permission revocation, preserves an empty import store under denial, and requires reauthentication/current access after regrant and reload. Separate selected imports and exact replay preserve the original file bytes. Existing restoration then submits one draft effect, recovers the exact original cancellation and prevents duplicate original effects.

The native writer tests additionally verify ciphertext round trips, private file permissions, no-overwrite behavior, dialog cancellation, revocation/lock during selection and scope/session anchoring. Returned native authority guards reject a shortened offline lease, revocation and profile removal. Foundation tests retain atomic storage-failure/capacity and expired-session coverage; those tests are not a substitute for actual process-interruption acceptance.

An initial product test exposed an inaccessible file input: its filename text was a sibling inside a single-control Field. Moving the filename outside Field restored its accessible label. Checkbox spacing now uses the existing check-row class. A later revocation fixture incorrectly tried to click an action already removed by received denial; it now verifies removal and unchanged storage, then reloads after regrant before unlocking. No CSS or theme changes were made.

Final checks for this product checkpoint:

- **960 unit/PostgreSQL tests across 123 files passed**, `/tmp/gabs-archive-final-regression.log`.
- Strict environment/type and dependency-boundary checks and **four fresh builds passed**, `/tmp/gabs-archive-final-types.log`, `/tmp/gabs-archive-final-lint.log`, `/tmp/gabs-archive-final-build.log`.
- **Six headless browser-suite journeys and four hidden/minimized native-suite journeys passed**, `/tmp/gabs-archive-final-web.log`, `/tmp/gabs-archive-final-native.log`. These include all four archive directions plus six existing single-file/command-snapshot regressions.
- Disposable databases/device profiles were removed. A subsequent cleanup removed one unused test import only. No signed-release bytes, CSS or theme definitions changed. Actual OS protection/MFA remain controlled fixtures.

### Visual evidence

Wide and 390px captures cover selection, masked export secrets and cleared import secrets. Dialog content scrolls on short viewports; long content remains inside the existing modal. Scoped Axe and narrow page-overflow checks run in the journeys. These captures verify the current engineering interface, not final UI approval.

| Direction | Export | Import |
| --- | --- | --- |
| Web to web | [Wide](web-to-web-export.png), [narrow](web-to-web-export-narrow.png) | [Wide](web-to-web-import.png), [narrow](web-to-web-import-narrow.png) |
| Web to desktop | [Wide](web-to-desktop-export.png), [narrow](web-to-desktop-export-narrow.png) | [Wide](web-to-desktop-import.png), [narrow](web-to-desktop-import-narrow.png) |
| Desktop to web | [Wide](desktop-to-web-export.png), [narrow](desktop-to-web-export-narrow.png) | [Wide](desktop-to-web-import.png), [narrow](desktop-to-web-import-narrow.png) |
| Desktop to desktop | [Wide](native-to-native-export.png), [narrow](native-to-native-export-narrow.png) | [Wide](native-to-native-import.png), [narrow](native-to-native-import-narrow.png) |

## Mixed-module and retained-review acceptance

The archive journey extends the real command-snapshot recovery workflow. A first device captures the linked command and parent; a second independently authenticated device imports those actual files, switches retained command reviews, resolves the original and submits a fresh correction after verifying its prerequisite. It then creates an independent Contacts draft through the normal editor and exports one encrypted archive containing both modules.

The third device starts with empty storage and receives only the encrypted archive. Removing Contacts write access hides its draft while allowing the other module's authorized copies to be inspected; nothing is admitted during denial. After regrant and reload, all eight snapshots become selectable again. The fixture compares every retained input with its source, checks saved-review provenance, verifies deduplication and proves that local promotion receipts are absent. After selected admission and reload, the journal and active draft slots remain empty, all imported copies remain exact, no copy has promotion metadata and server records remain unchanged. Explicitly restoring the retained command obtains its cancelled original outcome and preserves its call and reference hints. Restoring and saving the Contacts draft creates exactly one Contacts record without adding command-module effects. Original archive bytes remain unchanged.

This covers real mixed-module export, retained reviewed input, independent devices, additive admission and current original settlement. It does not establish every possible dependency graph or interrupted archive operation. The existing command preparation paths keep their previously verified explicit prerequisite/correction checks.

The initial fixture retried a close action during a dialog's exit animation. It now waits for each dialog to disappear before closing the next. A subsequent fixture assumed that enabling offline storage immediately creates a module-state record; the empty-device assertion now accepts the valid absence of that record. No production source, UI styling or release bytes changed.

Final mixed-archive verification:

- Strict environment/type and dependency-boundary checks passed: `/tmp/gabs-mixed-archive-final-types.log`, `/tmp/gabs-mixed-archive-final-lint.log`.
- **Four headless browser-suite journeys and two hidden/minimized native-suite journeys passed**: `/tmp/gabs-mixed-archive-final-web.log`, `/tmp/gabs-mixed-archive-final-native.log`. This includes the two mixed/retained journeys and all four original archive-transfer directions.
- All eight new captures were visually inspected. Scoped Axe and narrow-overflow checks passed. Disposable databases/profiles were removed; historical regression captures were preserved.
- This change adds acceptance tests only. The earlier 960-test/four-build result belongs to the unchanged production implementation; it is not a fresh regression/build run for this checkpoint. Actual provider/MFA and signed-platform acceptance remain separate.

| Surface | Mixed export | Mixed import |
| --- | --- | --- |
| Browser | [Wide](web-mixed-export.png), [narrow](web-mixed-export-narrow.png) | [Wide](web-mixed-import.png), [narrow](web-mixed-import-narrow.png) |
| Desktop | [Wide](native-mixed-export.png), [narrow](native-mixed-export-narrow.png) | [Wide](native-mixed-import.png), [narrow](native-mixed-import-narrow.png) |

## Required next work

- Exercise archive UI expiry, profile/scope transitions and process interruption, including interrupted native publication/admission and bounded multi-batch capacity. Unit guards and atomic-store tests provide implementation evidence, not all product acceptance.
- Retain actual provider/MFA, signed-platform, filesystem/platform durability and corporate old-key recovery as parent gates. Controlled native protection and development authentication do not establish those gates.

Broader corporate recovery graphs/transitions and key loss remain parent gates. Overall parity and later UI refinement remain open.
