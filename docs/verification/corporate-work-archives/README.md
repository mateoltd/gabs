# Encrypted corporate saved-work archives

Scope: **ID-03-BACKUP-ARCHIVE**, under ID-03-BACKUP-CORPORATE. Status: **verified within the evidence below**. The portable format, four-direction file transfer, mixed-module retained reviews, bounded batches, inspection/lease expiry, workspace/profile transitions, renderer interruption, native file publication and durable batch admission have scoped acceptance. This does not close broader corporate recovery, actual providers/platforms or physical durability gates.

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

## Inspection expiry and interrupted admission

The archive surface now clears stale inspected copies, selections and passphrase fields when their access guards expire or change. It explains that the user must load saved work or unlock the original file again with current access. This closes the previously silent transition where snapshots disappeared without a next step. The encrypted file and durable saved work are not deleted.

The lifecycle journey installs its test clock before observing any import proof, advances elapsed time past the five-minute inspection window and verifies that copies and the admission action disappear, secret fields clear and the notice appears. This is controlled elapsed-time acceptance of the real inspection guard; it does not establish corporate offline-lease or actual identity-provider expiry acceptance.

For both dialog cancellation and a real renderer crash, the fixture holds an actual authenticated server response before selected admission can finish. It then closes the surface or crashes the renderer, releases the late response, and verifies empty imported-copy, queue and draft state after recovery. Browser recovery opens a new page in the same saved browser context. Desktop recovery relaunches the application against the same protected store and the same controlled OS key, signs in through the normal development interface, and returns to the original workspace. Reopening the original encrypted file starts with no selected copies. The existing explicit import/restoration flow then completes, preserves file bytes and verifies one draft effect and the cancelled original request.

The first browser fixtures attempted to unroute and reload a crashed Playwright page. The final flow closes that page and opens another in the same context; interceptor cleanup follows recovery. The native fixture initially accepted briefly rendered cached startup UI as readiness. Development credentials are process-local, so it now waits for normal sign-in before checking workspaces. These were test orchestration fixes, not permission bypasses.

Full main/utility process failure during native publication or an in-progress durable write is not covered by a renderer crash before admission. Existing atomic-store/native-writer unit checks remain separate evidence. Profile/workspace changes, corporate offline-lease expiry and bounded multi-batch capacity remain required below.

Final lifecycle verification:

- Strict environment/type and dependency-boundary checks passed, plus **four fresh builds**: `/tmp/gabs-archive-life-final-types.log`, `/tmp/gabs-archive-life-final-lint.log`, `/tmp/gabs-archive-life-build.log`.
- **33 focused tests passed across three files**: 23 authority/native-writer tests in `/tmp/gabs-archive-life-final-unit.log` and 10 archive-format/collection tests in `/tmp/gabs-archive-life-format-unit.log`. The first command's archive filename filter matched no file, so that file was run explicitly afterward. No full-suite rerun is claimed.
- **Five headless browser-suite journeys and three hidden/minimized desktop-suite journeys passed**: `/tmp/gabs-archive-life-final-web.log`, `/tmp/gabs-archive-life-final-native.log`. These cover the new lifecycle paths, all four simple transfer directions and both mixed/retained workflows after the UI fix.
- All eight lifecycle captures were inspected. Scoped Axe and narrow-overflow checks passed. Disposable databases and profiles were removed; historical regression images were preserved. Scoped formatting passed in `/tmp/gabs-archive-life-final-format.log`.
- No CSS, theme, SDK contract or signed-release bytes changed. Test clocks, development authentication and controlled OS protection are explicit limits; actual providers/platforms remain separate.

| Surface | Expired inspection | Reopened after interruption |
| --- | --- | --- |
| Browser | [Wide](web-lifecycle-expired.png), [narrow](web-lifecycle-expired-narrow.png) | [Wide](web-lifecycle-reopened.png), [narrow](web-lifecycle-reopened-narrow.png) |
| Desktop | [Wide](native-lifecycle-expired.png), [narrow](native-lifecycle-expired-narrow.png) | [Wide](native-lifecycle-reopened.png), [narrow](native-lifecycle-reopened-narrow.png) |

## Count and byte bounded multi-batch recovery

A separately published, reviewed SDK module captures 33 small requests and five roughly 220 KB note requests through its actual offline UI. Its signed schema explicitly declares a 250,000-character field bound; SDK defaults and production limits are unchanged. The real encrypted archive is exported and opened in an independent empty browser or desktop store. All 38 copied requests match their original journal entries.

The final journey verifies:

- Selecting 33 copies disables admission. Selecting the five large copies exceeds the 1 MiB selection limit and admits nothing.
- Importing 32 small copies succeeds. An additional small copy fails the store-count bound and leaves the first batch exactly unchanged through reload.
- Explicit server settlement restores original requests for review, with their exact calls and cancellation outcomes. Removing only the retained imported copy leaves the restored journal entry intact and frees a slot for another batch.
- Four large copies fit alongside the remaining small copies. A fifth is rejected by total stored bytes even though the resulting count would be only 32. The prior store remains exact.
- Restoring/removing one large imported copy permits admission of the last one. After reload, every archive copy is present either as an exact retained input or an exact restored original call. The encrypted source file is unchanged and the server has zero business records for this fixture module.

The unfinished checkpoint fixture first exceeded the SDK's default 500-character text bound. An intermediate explicit 560,000-character field then exceeded the authoritative API's 256 KiB request-body bound during original settlement. The final fixture uses individually valid requests whose combined size crosses the import limit. Another initial failure clicked Close before post-removal refresh completed; the final journey waits for the enabled refresh control and removal confirmation. No production guard, limit or UI behavior was changed to satisfy these tests.

Final verification:

- One headless browser journey passed in 4.7 minutes: `/tmp/gabs-archive-capacity-web.log`.
- One hidden/minimized, unfocused native journey passed in 2.9 minutes: `/tmp/gabs-archive-capacity-native.log`. Source and destination use independent stores and controlled OS keys.
- Scoped Axe and narrow-overflow assertions passed; all eight count/full-store captures were inspected. Disposable databases and profiles were removed.
- Strict environment/type and dependency/copy checks passed: `/tmp/gabs-archive-capacity-types.log`, `/tmp/gabs-archive-capacity-lint.log`. Scoped test formatting passed: `/tmp/gabs-archive-capacity-format-check.log`.
- This increment changes acceptance tests only. Production source remains at the reviewed `9e5c1cd` implementation; no fresh full regression or build is claimed. Development authentication and controlled native keys do not prove actual MFA/provider or signed-platform acceptance.

| Surface | Count limit | Full store |
| --- | --- | --- |
| Browser | [Wide](web-capacity-count.png), [narrow](web-capacity-count-narrow.png) | [Wide](web-capacity-full.png), [narrow](web-capacity-full-narrow.png) |
| Desktop | [Wide](native-capacity-count.png), [narrow](native-capacity-count-narrow.png) | [Wide](native-capacity-full.png), [narrow](native-capacity-full-narrow.png) |

## Corporate lease expiry and workspace transitions

The lease journey captures a real offline Contacts request and independent draft, then exports their encrypted archive before expiry. Controlled clocks advance 25 hours against the ordinary corporate offline lease. Both clients hide the recovery surface, passphrase controls and saved input and explain that online authorization is required. Original journal entries, draft contents, draft versions and the exported file remain exact.

On desktop, main-process time advances first. A direct export using the captured module-host handle is rejected without a file while the renderer still shows its old access. Renderer time then advances and the visible corporate surface locks. This checks main-owned authority independently from UI visibility. Source and destination are separate processes/stores; the next device authenticates normally and imports/restores the original archive with authoritative settlement and exactly one explicitly submitted draft effect. The expired source receives no replacement credentials or copied authority.

The workspace journey opens an authorized archive preview, selects a copy, closes the dialog and switches through the normal workspace UI. A second company workspace cannot unlock the first workspace's archive, even with the correct passphrase; no decrypted copies, imported state, journal entries or drafts are created. Returning to the original workspace starts with empty secrets, file selection and copy selection. A fresh unlock and current authority are required before the ordinary import/restoration journey continues. This exercises normal UI switching, not an out-of-band multi-window transition.

Final verification:

- Lease expiry: one headless browser case and one hidden/minimized native case passed in `/tmp/gabs-archive-lease-web.log` and `/tmp/gabs-archive-lease-native.log`. The final native case places the rejected IPC attempt before renderer expiry.
- Workspace transitions: one browser and one native case passed in `/tmp/gabs-archive-workspace-web.log` and `/tmp/gabs-archive-workspace-native.log`.
- All four existing file-transfer directions passed again: three browser-suite cases in `/tmp/gabs-archive-transitions-web-regression.log` and one native case in `/tmp/gabs-archive-transitions-native-regression.log`.
- Strict type/environment, dependency/copy and scoped formatting checks passed: `/tmp/gabs-archive-transitions-types.log`, `/tmp/gabs-archive-transitions-lint.log`, `/tmp/gabs-archive-transitions-format.log`.
- All eight new wide/narrow captures were inspected. Axe and narrow-overflow assertions passed. Disposable databases/profiles were removed and historical rerun screenshots restored.
- This is acceptance-only work against the production implementation reviewed in `9e5c1cd`. No new full unit regression or production build is claimed. Simulated time, development authentication and controlled OS keys do not establish actual MFA/provider, operating-system clock, signed-platform or filesystem durability acceptance.

| Surface | Expired corporate lease | Other workspace refusal |
| --- | --- | --- |
| Browser | [Wide](web-lease-expired.png), [narrow](web-lease-expired-narrow.png) | [Wide](web-workspace-denied.png), [narrow](web-workspace-denied-narrow.png) |
| Desktop | [Wide](native-lease-expired.png), [narrow](native-lease-expired-narrow.png) | [Wide](native-workspace-denied.png), [narrow](native-workspace-denied-narrow.png) |

## Saved-profile transitions and late sign-out completion

The browser and native journeys hold an actual authenticated archive-admission response, close the review and switch profiles through the account menu. They release the old response after account authority is revoked, then authenticate as a second actual development account. No copied work is admitted. The second account cannot open the original encrypted file, inherit its preview/passphrase/selection, read the original native cache or export through the original native host handle. No destination file is created by that rejected export.

Returning through the saved-account chooser authenticates the original account again. Its import store, journal and drafts are unchanged. A fresh file selection, passphrase and explicit copy selection are required; the unchanged archive then completes the existing original-outcome settlement and single explicit draft-save journey.

This acceptance found an intermittent desktop sign-out race. `ProfileGate` remounts `Session` when native profile authority changes, before asynchronous native cleanup returns. The old screen's logout completion could clear the new screen's observed identity query and refetch through its stale observer, leaving “Opening your workspace” displayed. Temporary query tracing reproduced a completed identity error on a query with zero observers while the visible screen retained its removed pending query. Session cleanup now checks whether its owner is still mounted before changing query/UI state; native credential and authority cleanup still completes. No presentation or permission rules changed.

Increasing the chooser wait from five to fifteen seconds did not fix the pre-patch failure. The final test restores the original five-second expectation. Diagnostic logging is removed from source and rebuilt artifacts.

Native alternate-account selection changes only the next development-login request sent to the real API. It does not fabricate identity/session responses or bypass server authorization. Development authentication and controlled OS keys do not verify real-provider MFA, biometric integration or signed-platform acceptance.

Final verification:

- Strict environment/type, dependency/copy and scoped formatting checks passed: `/tmp/gabs-archive-profile-final-types.log`, `/tmp/gabs-archive-profile-final-lint.log`, `/tmp/gabs-archive-profile-final-format.log`.
- 42 focused identity, sign-out, profile and archive tests passed across six files: `/tmp/gabs-archive-profile-final-unit.log`.
- Eight headless browser journeys passed, covering archive profile recovery, saved profiles and sign-out recovery: `/tmp/gabs-archive-profile-final-web.log`. The managed browser server built the final web application.
- The native profile journey passed three consecutive times with the original five-second expectation: `/tmp/gabs-archive-profile-native-fixed.log`. One final run passed after making a missing native export fixture fail explicitly instead of skipping that assertion: `/tmp/gabs-archive-profile-final-native.log`.
- Three native regressions passed: independent-key archive transfer, protected-storage readiness and unreadable-lock-policy recovery. The real OS-protected PIN/restart case was skipped under its existing platform availability guard and is **not verified** here: `/tmp/gabs-archive-profile-final-native-regression.log`.
- The final desktop build passed: `/tmp/gabs-archive-profile-desktop-build.log`. No full unit regression or fresh server/worker build is claimed for this shell-only production change. Build output retains the existing bundle-size advisory.
- All four new wide/narrow captures were inspected. Scoped Axe and overflow checks passed. Native windows remained hidden/minimized and unfocused. Disposable databases/profiles were removed; historical rerun captures were restored.

| Surface | Other account refusal |
| --- | --- |
| Browser | [Wide](web-profile-denied.png), [narrow](web-profile-denied-narrow.png) |
| Desktop | [Wide](native-profile-denied.png), [narrow](native-profile-denied-narrow.png) |

## Main-process interruption during file publication

Three actual native UI export journeys terminate Electron main with `SIGKILL` at the filesystem boundary:

| Interruption | Observed result |
| --- | --- |
| Half the encrypted temporary file written | No published file. The private partial file cannot be unlocked. |
| Complete file flushed and closed, before publication | No published file. The private temporary file contains the complete authenticated archive. |
| Publication completed, before directory flush/acknowledgement | The published file is complete, private and authenticated despite the missing UI acknowledgement. |

The fixture records the reached boundary and observes the captured child-process handle terminate. Files use mode `0600`; neither temporary nor published bytes expose the known record name or account ID. The earlier valid archive remains byte-for-byte unchanged. A crash may leave an encrypted temporary file beside the destination; this evidence does not claim automatic cleanup of arbitrary external directories.

After same-store/key restart, journal entries, drafts and draft versions match exactly before reconnecting the company workspace. Development credentials are process-local, so the final flow obtains fresh company authorization and explicitly re-enables offline storage when needed. A simulated connection failure only for corporate module writes keeps the original request for later destination settlement; authentication, permissions, contracts and export authorization use actual server responses. Retry metadata may advance after reconnecting, while original request identity, call, dependencies and capture time remain unchanged, and the independent draft matches exactly.

A fresh UI export succeeds. An independent device then receives the surviving published file in the post-publication case, or the fresh retry file in the other cases. Existing tamper/permission/replay checks, original server cancellation and one explicit draft effect complete successfully. No credentials or leases are transferred.

Earlier fixture attempts incorrectly queried Playwright's process proxy after it had been disposed; the final fixture retains the live child handle before termination. Assuming immediate offline re-export after a development-session restart also failed authorization/readiness guards. The final flow refreshes actual authority instead of bypassing those guards. It does not establish real-provider offline cold-start acceptance.

Final verification:

- All three crash/restart/file-recovery cases passed: `/tmp/gabs-archive-publication-native-authorized.log`.
- Four browser-suite regressions passed: corporate lease expiry and web/web, web/desktop and desktop/web archive transfers. The browser runner built the unchanged web application: `/tmp/gabs-archive-publication-web-regression.log`. Disposable databases and profiles were removed.
- Native profile switching and inspection/renderer interruption individually passed with the shared harness: `/tmp/gabs-archive-publication-native.log`. That exploratory run also contained a subsequently corrected publication-fixture failure; it is not represented as a wholly passing suite.
- Strict environment/type, dependency/copy and scoped formatting checks passed: `/tmp/gabs-archive-publication-types.log`, `/tmp/gabs-archive-publication-lint.log`, `/tmp/gabs-archive-publication-format.log`.
- All six new wide/narrow captures were inspected. Scoped Axe/overflow checks passed; native windows remained hidden/minimized and unfocused.
- Production code is unchanged from `796cdd8`. No fresh full unit regression or desktop/server build is claimed. Process death is not power loss, disk failure, real OS key protection or cross-platform filesystem acceptance; those remain separate gates.

| Phase | Recovered export UI |
| --- | --- |
| Partial write | [Wide](native-publication-writing.png), [narrow](native-publication-writing-narrow.png) |
| Prepared file | [Wide](native-publication-prepared.png), [narrow](native-publication-prepared-narrow.png) |
| Published file | [Wide](native-publication-published.png), [narrow](native-publication-published-narrow.png) |

## Durable batch admission and lost acknowledgement

Four native journeys terminate the actual storage utility process, or main and its utility process, at the selected batch's write boundary. A temporary test bootstrap wraps the real compiled worker's request/reply boundary. It matches the selected workspace key and two-copy batch and verifies the explicitly armed main PID before sending `SIGKILL`. It does not replace SQLite writes or server responses.

| Boundary | State after same-store/key restart and fresh authorization |
| --- | --- |
| Before forwarding the selected write | Neither copy admitted. Explicit retry imports both copies. |
| After the real SQLite statement commits, before its reply reaches main | Both copies retained with exact input and original admission timestamps. Explicit retry adds zero copies. |

Both boundaries pass for main and utility termination. Utility-only failure leaves main alive and shows a protected-storage failure without reporting import success. The test observes the phase marker, utility exit and, where applicable, the captured main process's `SIGKILL`. Main remains hidden/minimized and unfocused throughout.

The destination starts with an unrelated Projects draft created through the real form. Its journal, drafts and draft versions survive restart exactly. After fresh account/workspace authorization, the archive must be selected and unlocked again. Imported copies contain only input and admission time, without copied promotion metadata. Repeated import preserves the exact retained map. The encrypted source file remains byte-for-byte unchanged.

After verifying retry idempotency, the journey explicitly removes the two inert copies using the review UI, then completes the shared denial/regrant, original cancellation and one-draft-effect recovery journey. The unrelated Projects draft is finally resumed through **Resume saved draft**, with its original name intact. An earlier fixture incorrectly used **New projects**, which intentionally opens a blank form; all four final journeys use the actual resume control.

Final verification:

- Four main/utility crash journeys passed: `/tmp/gabs-archive-admission-native-final.log`.
- Four native shared-harness regressions passed: three publication interruptions and independent-key native archive transfer, `/tmp/gabs-archive-admission-native-regression.log`.
- Three headless browser/cross-surface file transfers passed: `/tmp/gabs-archive-admission-web-regression.log`. The runner built the unchanged web application.
- Strict environment/type, dependency/copy and scoped formatting checks passed: `/tmp/gabs-archive-admission-types.log`, `/tmp/gabs-archive-admission-lint.log`, `/tmp/gabs-archive-admission-format-check.log`.
- All 12 new wide/narrow captures were inspected. Scoped Axe and overflow checks passed. Disposable databases/profiles were removed; historical rerun captures were restored.
- Visual review identified an existing raw Electron IPC prefix in the storage-error message. It is recorded in the separately queued UI-refinement inventory; these captures establish readable failure/recovery states, not final design approval.
- Production source is unchanged from `796cdd8`. No new full unit regression or desktop/server build is claimed. These are actual process crashes at the request/committed-reply boundary, not power loss or interruption inside a native SQLite instruction. Development authentication and controlled OS-protection keys do not establish actual provider/MFA, OS key protection or cross-platform durability acceptance.

| Process / phase | Failure | Recovered retry |
| --- | --- | --- |
| Utility / before write | [Wide](native-admission-utility-before-failed.png), [narrow](native-admission-utility-before-failed-narrow.png) | [Wide](native-admission-utility-before-recovered.png), [narrow](native-admission-utility-before-recovered-narrow.png) |
| Utility / committed | [Wide](native-admission-utility-committed-failed.png), [narrow](native-admission-utility-committed-failed-narrow.png) | [Wide](native-admission-utility-committed-recovered.png), [narrow](native-admission-utility-committed-recovered-narrow.png) |
| Main / before write | Application terminated | [Wide](native-admission-main-before-recovered.png), [narrow](native-admission-main-before-recovered-narrow.png) |
| Main / committed | Application terminated | [Wide](native-admission-main-committed-recovered.png), [narrow](native-admission-main-committed-recovered-narrow.png) |

## Required parent work

ID-03-BACKUP-ARCHIVE is verified within the recorded implementation-specific evidence. ID-03-BACKUP-CORPORATE remains active for broader recovery graphs/source transitions, promotion interruption and corporate old-key/unreadable-store recovery. Actual provider/MFA, signed-platform and physical/filesystem durability acceptance remain required. No credentials or offline authority may be restored. Overall parity and later UI refinement remain open.
