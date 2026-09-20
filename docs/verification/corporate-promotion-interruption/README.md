# Interrupted corporate saved-work restoration

Scope: **ID-03-BACKUP-INTERRUPTION**, under ID-03-BACKUP-CORPORATE. Status: **active**. Archive admission and device preparation are verified separately. This record covers the later explicit restoration of an imported copy into a local request or draft.

## Acceptance matrix

| Boundary | Existing evidence | Required product evidence |
| --- | --- | --- |
| Lost authoritative settlement reply | Real API and import unit tests retain the copy and retry the exact original identity | **Passed:** main crash while an actual cancellation response is held, then exact original retry without duplicate server audit/effect |
| Local request/draft write before commit | Unit atomic-store failure checks | **Passed:** main and utility process death for both requests and drafts, retained source input and unrelated local work, then fresh-authority retry |
| Local write committed, acknowledgement lost | Unit duplicate-promotion checks | **Passed:** main and utility process death for both requests and drafts, durable receipt plus restored request/draft, no duplicate import/restoration |
| Permission revocation during restoration | Unit revoked authority and real UI denial before restoration | Hold actual in-flight restoration, deliver current denial, retain input and require fresh grant/review |
| Profile/session/expiry changes during restoration | Shared session/host guards and archive-admission lifecycle journeys | Ordinary-promotion-specific late completion, expiry and profile-lock acceptance, including an actual committed write whose UI acknowledgement is held |

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

The eight storage-boundary cases kill the process after the server reply has arrived. The separate settlement-response case below covers reply loss before consumption. Permission/profile/session/expiry rows above remain open. No new full unit regression or desktop build is claimed for these test-only changes.

Actual identity/OS providers, signed target platforms and physical power-loss durability remain parent gates. Controlled development authentication and native protection are stated limits. No UI design approval or whole-product parity is claimed.


## Lost authoritative cancellation reply

The actual native Settings restoration calls the server with the exact exported create key and input. A temporary main-process fetch wrapper holds the real successful cancellation response before returning it to the application; it does not fabricate a body, status or authority proof. While that response remains held, an independent PostgreSQL read verifies exactly one committed cancellation audit. Original imports, journal and drafts remain unchanged, and no restoration success is shown.

The test verifies that native windows remain hidden/minimized and unfocused, kills the observed main child process with `SIGKILL`, and restarts the same encrypted store. Fresh sign-in and explicit restoration recover the original decision; repeated import preserves the receipt and input. The shared journey checks late original-send refusal, one independent draft effect and resumption of an unrelated Projects draft.

The first targeted journey and the final combined run passed. Final verification: **13 native cases** (the lost-reply case, eight promotion crashes and four archive-admission regressions), strict type/boundary/copy checks and scoped formatting. The final wide/narrow captures were inspected; scoped Axe and overflow checks passed. The isolated database was removed. Production source remains unchanged; this controlled cancellation-response case does not replace actual-provider, physical power-loss or the remaining in-flight authority-transition gates. No new browser suite, full unit regression or product build is claimed.

Final command: `playwright test --config playwright.desktop.config.ts tests/desktop/corporate-settlement-crash.spec.ts tests/desktop/corporate-promotion-crash.spec.ts tests/desktop/corporate-archive-admission.spec.ts`, using the isolated PostgreSQL runner. Local logs: `/tmp/gabs-settlement-crash-native-final.log`, `/tmp/gabs-settlement-crash-types.log`, `/tmp/gabs-settlement-crash-lint.log` and `/tmp/gabs-settlement-crash-format-check.log`. Captures: [wide](../corporate-work-archives/native-promotion-settlement-reply-lost.png) and [narrow](../corporate-work-archives/native-promotion-settlement-reply-lost-narrow.png).

Fixture: [native settlement crash](../../../tests/desktop/corporate-settlement-crash.spec.ts), [actual-response hold and process termination](../../../tests/support/corporate-portability/settlement-crash.ts), and [shared original-input/retry checks](../../../tests/support/corporate-portability/promotion-crash.ts). The storage crash fixture supplies its own interruption callback to the same recovery checks, retaining its eight original cases.
