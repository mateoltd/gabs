# Authority changes during command recovery

Scoped OFF-01 evidence, 18 September 2026. Full parity remains open.

## Change

Recovery now rechecks current access immediately before settlement after asynchronous storage/contract work. Uncertain journal settlement also rechecks inside its final storage transaction, after waiting for the workspace storage lock. A denial retains the original identity/input for later authorized recovery. These checks supplement authoritative server validation; they do not revoke an already committed server outcome.

No host UI or stylesheet changed. The previous milestone's command reviews, cancellation fence and selected-dependent semantics remain intact.

## Observable acceptance

Browser and hidden native journeys use a signed executable module, real API/PostgreSQL state and durable client storage. Each new case captures a parent and two dependents offline, saves a correction, restarts offline and selects one dependent. The server then settles the exact original while its response is held in the transport.

- **Lease expiry:** the client disconnects and advances its clock beyond the 24-hour lease. Saved command dialogs disappear and the workspace requests online revalidation. Releasing the delayed reply cannot create a replacement or discard the journal/review.
- **Received revocation:** actual role permission is removed, its durable policy revision advances and normal policy delivery updates the open client. Capture becomes disabled and saved input disappears before the delayed reply is released. The original calls and review remain byte-equivalent in storage; no new business record exists.
- After fresh authorization, both cases prove a late retry of the original receives `ATTEMPT_CANCELLED`. Another offline browser reload/native process restart retains the saved correction. Explicit preparation then creates exactly one replacement plus the selected dependent, with exactly two records and two creation audits. The unselected dependent remains unchanged.

The native test uses renderer clock expiry while preserving the real main-process/server clocks. It verifies shell/journal behavior, not a new proof of host-owned capability lease cryptography; that authority has separate evidence. Server fixtures change actual stored role permissions and issue normal policy notifications. The held reply is a transport fault, not a mocked server decision.

## Sources

- [Command recovery](../../../packages/client/src/modules/command-recovery.ts), [uncertain settlement](../../../packages/client/src/modules/settlement.ts).
- [Focused authority tests](../../../tests/unit/command-recovery.test.ts), [shared journey](../../../tests/support/command-correction-journey.ts), [web runner](../../../tests/e2e/command-correction.spec.ts), [native runner](../../../tests/desktop/command-correction.spec.ts).

## Verification

- `pnpm build`: passed strict root/browser/Node/preload/worker checks, boundary/copy checks and four fresh builds. `/tmp/gabs-command-authority-build.log`. Existing bundle-size warnings remain.
- Focused recovery tests: **13/13 passed** across two files. `/tmp/gabs-command-authority-unit.log`.
- Full isolated PostgreSQL/unit suite: **502/502 passed across 84 files**. `node /tmp/gabs-host-ui-browser-isolated.mjs exec vitest run`; `/tmp/gabs-command-authority-full.log`.
- Headless browser: **5/5 passed**, including both new authority transitions and all three existing command-correction branches. `node /tmp/gabs-host-ui-browser-isolated.mjs exec playwright test tests/e2e/command-correction.spec.ts`; `/tmp/gabs-command-authority-web.log`.
- Hidden/unfocused Electron: **6/6 passed**, the five corresponding command cases plus the existing resource-settlement restart regression. `node /tmp/gabs-host-ui-browser-isolated.mjs exec playwright test --config playwright.desktop.config.ts tests/desktop/command-correction.spec.ts tests/desktop/attempt-settlement.spec.ts`; `/tmp/gabs-command-authority-native.log`.
- Scoped dialog Axe, keyboard interaction and narrow overflow assertions passed. Six representative captures were inspected, listed below. All sixteen new captures are retained; twenty modified historical regression captures were restored to committed bytes. No UI/style source changed.
- Changed code passes Prettier and `git diff --check`. Builds and acceptance runners were serialized; isolated databases were removed and shared development servers preserved. All final runs passed without a test rerun or weakened assertion.

## Representative visual review

- [Browser lease expiry](web-lease-expired-blocked-narrow.png), [native lease expiry](native-lease-expired-blocked-narrow.png).
- [Browser received revocation](web-permission-revoked-blocked-narrow.png), [native received revocation](native-permission-revoked-blocked-narrow.png).
- [Browser wide saved review](web-lease-expired-review.png), [native authorized recovery outcome](native-permission-revoked-result-narrow.png).

The blocked states remove corporate saved input and retain clear revalidation guidance or disabled capture. The existing shell, controls and review layout remain consistent; this is scoped continuity evidence, not final UI approval.

## Remaining requirements

- Original versus current permission declarations when installed module releases change; cross-release command correction and schema/reference-aware review.
- Profile/sign-out recovery, permanent revocation and authorized recovery/export choices. Process restart is not profile-removal acceptance.
- Cross-module/resource dependents, submitted-child outcomes, archive/custom descendants, history retention and full scheduling simulation.
- The previously recorded intermittent native linked-create dialog-close concern remains unresolved. Broad OFF-01, product and release acceptance are not closed here.
