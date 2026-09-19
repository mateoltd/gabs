# Submitted descendant outcomes

Status: OFF-01-OUTCOME verified for the scope below on 19 September 2026. OFF-01 and full parity remain active.

## Observable recovery

Two independently signed modules capture a rejected parent and two unsent dependents. Existing review, offline restart and held-settlement child-revocation checks run first. The user explicitly continues one dependent after reauthorization; the other stays attached to the stopped original parent.

For command, create, update and archive children, real transport faults make the selected child's outcome uncertain after its corrected parent succeeds. One branch commits on the server and loses the response; the other interrupts transport before execution. The journal is observed, never edited to manufacture uncertainty. An unrelated queued command completes while this child remains unresolved.

Each journey inspects original input after offline browser reload/native process restart, explicitly settles through Settings, loses that settlement reply, restarts again, then recovers the same identity. Final checks assert exact input/dependencies, unchanged unselected work, original-version outcomes, authoritative record/audit counts and late retry behavior. Cancellation fences the original request; recovery never allocates a replacement identity automatically. Accepted updates/archives change only the selected version-1 target to version 2; cancelled writes leave it unchanged.

## Product correction

The new browser journeys reproduced starvation: one ambiguous transport failure stopped the entire journal pass, leaving an unrelated captured command pending behind it.

The [SDK journal runner](../../../packages/sdk/src/contracts/sync.ts) now separates ambiguous outcomes from reasons to stop the whole pass. Network failures, HTTP 408 and server errors preserve the original uncertain request and let other eligible work have one attempt. Authentication, membership/MFA failures and HTTP 429 still stop the pass. Live authorization, cancellation and connectivity guards run before each send; dependents require accepted prerequisites. There is no retry loop within a pass. A whole-network outage detected by the host still prevents dispatch; this change does not infer that any failed request was rejected or accepted.

No production UI, styles, IPC permissions, server business rules or request identities changed. Parent review checked the shared-stop conditions, retained uncertainty, dependency release, per-pass attempt bound and current host guards.

## Verification

| Check | Result and evidence |
| --- | --- |
| Failing baseline | Both representative browser cases reached the uncertain child and then failed the unrelated-progress assertion. Four new delivery tests reproduced the same starvation (4 failed, 14 passed): `/tmp/gabs-submitted-web-recheck.log`, `/tmp/gabs-submitted-before.log`. |
| Focused correction | 25 delivery/workspace tests passed; both representative browser journeys passed: `/tmp/gabs-submitted-unit.log`, `/tmp/gabs-submitted-web-fix.log`. |
| Strict checks and builds | Root/browser/Node/preload/worker type checks, boundary/copy checks and four fresh builds passed. Final test-source type/lint checks also passed: `/tmp/gabs-submitted-build.log`, `/tmp/gabs-submitted-final-types.log`, `/tmp/gabs-submitted-final-lint.log`. The existing large-web-chunk warning remains. |
| Full regression | 567 tests across 89 files passed in one uninterrupted run: `/tmp/gabs-submitted-regression.log`. |
| Headless Chromium | All eight submitted outcomes plus existing cross-module command and command-to-create continuation passed, 10/10: `/tmp/gabs-submitted-web-final.log`. |
| Hidden/minimized Electron | The same 10/10 journeys passed through real encrypted-storage process restarts; each asserts hidden/minimized and unfocused windows: `/tmp/gabs-submitted-native-final.log`. |
| Presentation | Scoped dialog Axe and overflow assertions passed. Eight final captures were inspected: command/update uncertain wide views and create/archive cancelled narrow views, on web and native. Original values, distinct outcome labels and recovery controls remain readable. This is continuity evidence, not whole-product accessibility or final design approval. |

The first browser run had a separate harness navigation race: Escape arrived while nested correction dialogs were closing and left Saved commands open. The harness now explicitly closes and awaits that dialog before navigation. The later unrelated-progress failure was a product bug; the distinction is retained rather than treating all failures as test timing. No acceptance timeout was relaxed.

The [shared journey](../../../tests/support/submitted-descendants.ts) owns final state/audit assertions. Each action/outcome subdirectory retains uncertain-wide and resolved-narrow captures for both clients (32 images). Historical screenshots overwritten by the two continuation regressions were restored.

## Remaining scope

This proves outcomes after a reviewed command parent releases a previously unsent child. It does not establish every legacy graph or failed-create collision migration: previously submitted children encountered during parent target replacement, unknown source-contract transitions, archive/custom collision descendants and corrupt-cycle recovery remain distinct OFF-01 work. Working sets, sign-out/profile removal, personal imports, release/provider gates and full parity remain required. No broad requirement is newly closed or deferred, and UI refinement has not started.
