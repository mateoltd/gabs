# Interrupted corporate saved-work restoration

Scope: **ID-03-BACKUP-INTERRUPTION**, under ID-03-BACKUP-CORPORATE. Status: **active**. Archive admission and device preparation are verified separately. This record covers the later explicit restoration of an imported copy into a local request or draft.

## Acceptance matrix

| Boundary | Existing evidence | Required product evidence |
| --- | --- | --- |
| Lost authoritative settlement reply | Real API and import unit tests retain the copy and retry the exact original identity | **Passed:** main crash while an actual cancellation response is held, then exact original retry without duplicate server audit/effect |
| Local request/draft write before commit | Unit atomic-store failure checks | **Passed:** main and utility process death for both requests and drafts, retained source input and unrelated local work, then fresh-authority retry |
| Local write committed, acknowledgement lost | Unit duplicate-promotion checks | **Passed:** main and utility process death for both requests and drafts, durable receipt plus restored request/draft, no duplicate import/restoration |
| Permission revocation during restoration | Unit revoked authority and real UI denial before restoration | **Passed on web and desktop:** revoke an ordinary business role through the public administration API while settlement waits; retain input and require fresh grant/review |
| Recovery session expires during restoration | Server recovery clock and five-minute MFA checks | **Passed on web and desktop:** expire the exact recovering server session while settlement waits, retain work and require fresh UI sign-in before explicit restoration |
| Profile lock after a committed restoration write | Shared session/host guards and process-crash receipt checks | **Passed on desktop:** real request promotion commits before PIN lock; its held acknowledgement is released while locked or after unlock, with preserved receipt/input and usable explicit refresh |
| Profile/session replacement or lock before restoration commits | Shared session/host guards and archive-admission lifecycle journeys; fresh session after expiry below | Ordinary-promotion-specific replacement and pre-commit lock acceptance remain required |

The matrix does not reopen completed archive, device, collision/reference or snapshot gates. Source/schema/target transitions remain in the corporate parent until their existing evidence has been reconciled separately.

## Process interruption implementation

A temporary test bootstrap wraps the actual compiled SQLite worker's request/reply boundary. It arms only the selected imported-copy digest and workspace key, verifies the live parent PID, and terminates the utility or main plus utility before forwarding the write or after the real committed write returns. It does not fabricate persistence or server outcomes. Archive-admission tests reuse the same worker wrapper with their existing batch trigger.

Each journey transfers the actual encrypted source archive to an independent destination, then creates an unrelated Projects draft through its normal form. Request restoration settles the exact original on the authoritative server before attempting its local write. A missing local receipt must leave the copy unpromoted; a committed receipt must be stored with the restored request or separate draft. After restart and fresh authorization, the normal imported-work UI recovers/retries. Reimporting the same file must preserve the original receipt, journal and drafts. The parent journey then verifies late original-send refusal and one independent draft effect; the unrelated Projects draft must still resume intact.

## Verification, 20 September 2026

Production source is unchanged from `96cd0ca`; these changes add acceptance fixtures and share the real-worker crash wrapper with archive-admission tests.

- Full strict root/browser/Node/preload/worker type checks and boundary/copy checks passed.
- Final native run: **12 passed**, comprising eight request/draft promotion cases (main/utility, before write/after commit) and four archive-admission regressions. Desktop tests retained the hidden/minimized configuration.
- Final headless browser/cross-surface run: **three passed**, covering web-to-web, web-to-desktop and desktop-to-web actual encrypted archive transfers. Both disposable PostgreSQL databases were removed after completion.
- Each request crash case checked exactly one durable `module.attempt.cancel` audit before restart and after retry/reimport. The parent journey checked refusal of the late original request and one independent draft effect. All eight cases resumed the unrelated Projects draft with its exact saved name.
- All **16 wide/narrow captures** were inspected. The imported-work dialog presents retained copies and restoration outcomes with readable wrapping; narrow request cases use the existing vertical scroll area. Scoped Axe and overflow checks passed. This is continuity evidence, not UI design approval.

Reproduce with the project's isolated PostgreSQL setup, running `playwright test --config playwright.desktop.config.ts tests/desktop/corporate-promotion-crash.spec.ts tests/desktop/corporate-archive-admission.spec.ts`, then `playwright test tests/e2e/corporate-archive.spec.ts`. Local execution logs: `/tmp/gabs-promotion-crash-native-final.log`, `/tmp/gabs-promotion-crash-browser-regression.log`, `/tmp/gabs-promotion-crash-types.log` and `/tmp/gabs-promotion-crash-lint.log`.

Captures are in [the archive evidence directory](../corporate-work-archives/README.md), named `native-promotion-{request|draft}-{main|utility}-{before|committed}.png` with corresponding `-narrow.png` files.

## Remaining acceptance

The eight storage-boundary cases kill the process after the server reply has arrived. The separate settlement-response case below covers reply loss before consumption. Server-enforced expiry and post-commit request acknowledgement across PIN lock are verified below. Pre-commit locks and profile/session replacement during ordinary restoration remain open.

Actual identity/OS providers, signed target platforms and physical power-loss durability remain parent gates. Controlled development authentication and native protection are stated limits. No UI design approval or whole-product parity is claimed.


## Lost authoritative cancellation reply

The actual native Settings restoration calls the server with the exact exported create key and input. A temporary main-process fetch wrapper holds the real successful cancellation response before returning it to the application; it does not fabricate a body, status or authority proof. While that response remains held, an independent PostgreSQL read verifies exactly one committed cancellation audit. Original imports, journal and drafts remain unchanged, and no restoration success is shown.

The test verifies that native windows remain hidden/minimized and unfocused, kills the observed main child process with `SIGKILL`, and restarts the same encrypted store. Fresh sign-in and explicit restoration recover the original decision; repeated import preserves the receipt and input. The shared journey checks late original-send refusal, one independent draft effect and resumption of an unrelated Projects draft.

The first targeted journey and the final combined run passed. Final verification: **13 native cases** (the lost-reply case, eight promotion crashes and four archive-admission regressions), strict type/boundary/copy checks and scoped formatting. The final wide/narrow captures were inspected; scoped Axe and overflow checks passed. The isolated database was removed. Production source remains unchanged; this controlled cancellation-response case does not replace actual-provider, physical power-loss or the remaining in-flight authority-transition gates. No new browser suite, full unit regression or product build is claimed.

Final command: `playwright test --config playwright.desktop.config.ts tests/desktop/corporate-settlement-crash.spec.ts tests/desktop/corporate-promotion-crash.spec.ts tests/desktop/corporate-archive-admission.spec.ts`, using the isolated PostgreSQL runner. Local logs: `/tmp/gabs-settlement-crash-native-final.log`, `/tmp/gabs-settlement-crash-types.log`, `/tmp/gabs-settlement-crash-lint.log` and `/tmp/gabs-settlement-crash-format-check.log`. Captures: [wide](../corporate-work-archives/native-promotion-settlement-reply-lost.png) and [narrow](../corporate-work-archives/native-promotion-settlement-reply-lost-narrow.png).

Fixture: [native settlement crash](../../../tests/desktop/corporate-settlement-crash.spec.ts), [actual-response hold and process termination](../../../tests/support/corporate-portability/settlement-crash.ts), and [shared original-input/retry checks](../../../tests/support/corporate-portability/promotion-crash.ts). The storage crash fixture supplies its own interruption callback to the same recovery checks, retaining its eight original cases.


## Public permission revocation during restoration

[The web/native journey](../../../tests/e2e/corporate-promotion-revocation.spec.ts) transfers actual encrypted archives to independent stores, then exercises [in-flight revocation](../../../tests/support/corporate-portability/promotion-revocation.ts) through the public API. A second development account accepts an owner invitation; that owner assigns the recovering actor a normal business role and changes its registered Contacts write permission. Protected Owner/Administrador permissions are never edited directly, and the final owner safeguard remains in force. Administrator changes, invitation acceptance and regrant use normal authenticated, CSRF-protected, idempotent routes; no role table or authorization response is fabricated.

The test holds the actual original settlement response. After write permission is revoked, releasing that response cannot restore the request: no promotion receipt, changed journal or draft is written; both imported copies remain exact; the dialog hides inaccessible restoration controls and displays an error. Refresh under the same denial still refuses restoration. Regrant alone does not promote input: explicit refresh, review and confirmation recover the original cancelled request. Exactly one cancellation audit exists. The full journey then refuses the late original request, creates one independent draft effect, and resumes an unrelated Projects draft with its original saved name.

The fixture restores the actor's original role and explicitly refreshes its copies before continuing. Setup policy changes occur before selecting a copy because policy revisions correctly invalidate existing confirmations. An initial fixture waited on that invalidated confirmation; a second exposed the same required refresh after cleanup. Those fixture ordering errors were corrected without changing production behavior.

The final new journeys passed on headless web and hidden/minimized desktop. All eight denial/restoration wide/narrow captures were inspected; scoped Axe and overflow checks passed. Denial hides the copies, and restored lists retain their existing vertical scroll area. The generic denial instruction is recorded for the queued UI refinement goal, not treated as polished copy. Final strict type/boundary/copy and scoped formatting checks passed. Two new web/native permission journeys and five regressions passed: web/native archive lifecycle, web/native saved-profile transition, and native settlement-reply loss. After correcting native helper disposal to retain the process handle before application closure, all three native regressions and the native permission journey passed again. The eight final permission captures match the inspected files byte for byte. All disposable databases were removed. No new full unit regression or product build is claimed. Production source remains unchanged from `96cd0ca`; actual identity/OS providers, signed targets, physical durability, profile/session/expiry transitions and overall parity remain open.

Captures in the [archive evidence directory](../corporate-work-archives/README.md) use `{web|desktop}-promotion-permission-{denied|restored}.png` with matching `-narrow.png` files. Local product log: `/tmp/gabs-promotion-authority-product.log`. The [shared response gate](../../../tests/support/corporate-portability/server-reply.ts) now owns actual-response holding, bounded arrival observation and release/disposal; archive lifecycle/profile journeys retain the same interface through their wrapper.


Final permission-run logs: `/tmp/gabs-promotion-authority-product.log`, `/tmp/gabs-promotion-authority-browser-regression.log`, `/tmp/gabs-promotion-authority-native-final.log`, `/tmp/gabs-promotion-authority-desktop-final.log`, `/tmp/gabs-promotion-authority-types-final.log`, `/tmp/gabs-promotion-authority-lint-final.log` and `/tmp/gabs-promotion-authority-format-final.log`. Reproduce with isolated PostgreSQL and `playwright test tests/e2e/corporate-promotion-revocation.spec.ts`, the browser archive lifecycle/profile specs, then the corresponding desktop specs plus `corporate-settlement-crash.spec.ts` under `playwright.desktop.config.ts`.


## Server-enforced recovery expiry during settlement

[The web/native expiry journey](../../../tests/e2e/corporate-promotion-expiry.spec.ts) holds the actual cancellation response before local restoration. [The fixture](../../../tests/support/corporate-portability/promotion-expiry.ts) matches the observed recovery-session identity to exactly one disposable database session and ages only its authentication time beyond the server's five-minute MFA recovery window. The real recovery endpoint returns `403 REAUTHENTICATION_REQUIRED`; no authorization body or receipt is synthesized, and the client clock is unchanged.

Releasing the settlement reply cannot promote the imported request or report restoration success. Both copied inputs, the journal and an unrelated Projects draft remain exact. Explicit refresh under the expired session still hides restoration controls. The normal profile-switch/sign-in UI issues a different, fresh server session for the same account; returning to the company retains the saved work and requires explicit review/confirmation. One original cancellation audit exists before expiry and after recovery. The complete journey refuses the late original request, creates one independent draft effect and resumes the unrelated Projects draft with its saved name.

Final verification on 20 September 2026: **two journeys passed**, headless web and hidden/minimized desktop, with strict root/browser/Node/preload/worker types, boundary/copy checks and scoped formatting. All **eight** expired/renewed wide/narrow captures were inspected; scoped Axe and overflow checks passed. The disposable database was removed. This is test-only work against production source `96cd0ca`; no new full unit regression or product build is claimed. Session aging is a controlled database condition using development authentication and controlled native keys, not actual-provider or elapsed wall-clock endurance acceptance. Profile-lock/replacement late completion and overall parity remain open.

Reproduce with isolated PostgreSQL and `playwright test tests/e2e/corporate-promotion-expiry.spec.ts`. Logs: `/tmp/gabs-promotion-expiry-product.log`, `/tmp/gabs-promotion-expiry-types.log`, `/tmp/gabs-promotion-expiry-lint.log` and `/tmp/gabs-promotion-expiry-format-check.log`. Captures in the [archive evidence directory](../corporate-work-archives/README.md) use `{web|desktop}-promotion-session-{expired|renewed}.png` and corresponding `-narrow.png` files.


## Profile lock after committed restoration

[The native lock journey](../../../tests/desktop/corporate-promotion-lock.spec.ts) transfers an actual encrypted archive between independently keyed devices, creates an unrelated Projects draft and enables the normal device PIN. A [temporary utility wrapper](../../../tests/support/corporate-portability/storage-reply.ts) identifies the exact workspace, imported-copy digest and live parent PID, lets the real SQLite write commit, then holds only its acknowledgement. A separate authorized read observes the durable original request, cancelled outcome and promotion receipt before locking.

The two timings release the actual reply while locked or after a PIN unlock. Locked cache reads are denied. The test waits for the original promotion to leave its real synchronization lock before checking the UI. Explicit refresh after unlock observes the existing receipt; exact imported input, unrelated copies, original journal call, drafts and source file bytes remain unchanged. One cancellation audit exists, the late original send is refused, and the complete journey produces one independent Contacts draft effect and resumes the unrelated Projects draft by its saved name.

The first run reproduced two defects: acknowledgement while locked left `Refresh imported copies` disabled after unlock, and acknowledgement after unlock displayed a success notice from the cancelled action. Import, restoration and removal now recheck their caller after the durable write. A failed acknowledgement leaves the committed copy, receipt or removal intact. The shell clears cancelled busy/controller state when its preserved surface resumes or its scope changes; obsolete completions cannot clear a newer controller. No styles or Electron authority boundaries changed.

Four focused unit regressions cover lock/cancellation after a real adapter write, exact retained receipts, duplicate-safe explicit retry without another write/settlement, and committed admission/removal with unrelated copies preserved. These use a controlled adapter; the native journey supplies actual SQLite and UI evidence for request restoration. Pre-commit locks and profile/session replacement during ordinary restoration remain open. The test uses development authentication and controlled OS protection; actual identity/OS providers, signing and physical power loss are separate gates.


Final verification on 20 September 2026 passed **208 focused tests** across import, module storage and architecture boundaries, strict root/browser/Node/preload/worker checks, dependency/copy checks and **four fresh builds**. **Seven product journeys** passed on final source: both new native lock timings, native archive profile isolation, web import, and actual web-to-web/web-to-desktop/desktop-to-web archive transfers. Browser runs were headless; native windows remained hidden/minimized and unfocused. All disposable databases were removed. The earlier session-completion regression also passed before the final admission/removal acknowledgement checks; it is not counted in the seven final-source journeys.

All **four** new wide/narrow captures were inspected, including the changed narrow capture from the final rerun; the two final narrow captures are byte-identical. Scoped Axe and overflow checks passed. Existing incidental screenshot changes from shared regression journeys were discarded. This is continuity evidence, not UI design approval. Existing bundle-size warnings remain. No full-unit/PostgreSQL suite or external-provider acceptance is claimed.

Local logs: `/tmp/gabs-promotion-lock-before.log` (the two reproduced UI failures), `/tmp/gabs-promotion-lock-final-unit.log`, `/tmp/gabs-promotion-lock-final-build.log`, `/tmp/gabs-promotion-lock-browser-final.log`, `/tmp/gabs-promotion-lock-native-final.log` and `/tmp/gabs-promotion-lock-format-check.log`. Reproduce with isolated PostgreSQL and `playwright test tests/e2e/corporate-import.spec.ts tests/e2e/corporate-archive.spec.ts`, followed by `playwright test --config playwright.desktop.config.ts tests/desktop/corporate-promotion-lock.spec.ts tests/desktop/corporate-archive-profile.spec.ts`.

Captures: [locked reply, wide](../corporate-work-archives/native-promotion-lock-locked.png), [locked reply, narrow](../corporate-work-archives/native-promotion-lock-locked-narrow.png), [reply after unlock, wide](../corporate-work-archives/native-promotion-lock-unlocked.png), [reply after unlock, narrow](../corporate-work-archives/native-promotion-lock-unlocked-narrow.png).
