# Interrupted corporate saved-work restoration

Scope: **ID-03-BACKUP-INTERRUPTION**, under ID-03-BACKUP-CORPORATE. Status: **active**. Archive admission and device preparation are verified separately. This record covers the later explicit restoration of an imported copy into a local request or draft.

## Acceptance matrix

| Boundary | Existing evidence | Required product evidence |
| --- | --- | --- |
| Lost authoritative settlement reply | Real API and import unit tests retain the copy and retry the exact original identity | Main crash while an actual settlement response is held, then retry without duplicate server audit/effect |
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

The request cases kill the process after the server reply has arrived and before or after local persistence. They do **not** establish main death while the actual settlement reply itself is held/lost. That case and the permission/profile/session/expiry rows above remain open. No new full unit regression or desktop build is claimed for these test-only changes.

Actual identity/OS providers, signed target platforms and physical power-loss durability remain parent gates. Controlled development authentication and native protection are stated limits. No UI design approval or whole-product parity is claimed.
