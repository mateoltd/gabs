# Saved command correction

Scoped OFF-01 acceptance, 18 September 2026. Full functionality parity and final UI refinement remain open.

## Behavior and boundaries

- Rejected/conflicting commands retain their exact original call and can save a separate, revisioned review. Partial invalid input is saveable; replacement requires the current signed installed contract and valid input. Uncertain commands must resolve their outcome first.
- Authoritative settlement precedes any replacement identity. An accepted original recovers its validated result and keeps the correction unsubmitted. A cancelled original is persisted before the atomic replacement transaction, so interrupted local writes or lost server replies retain recoverable input and a safe retry identity.
- Continuation is explicit and limited to eligible never-submitted direct dependents. Fingerprints bind approval to exact calls and dependency lists. Selected children keep their request bodies; unselected, submitted and foreign work is unchanged. Changed authority and stale choices fail. The UI currently exposes same-module commands only.
- Replacement retains explicit prerequisites and derives reference prerequisites from corrected input. Original and review contracts survive upgrades. Opaque special-property request identities use own-property storage. Generic journal replacement cannot bypass authoritative command recovery.
- Existing host Modal, SchemaForm, ResourceValue and controls are reused; no stylesheet or signed historical package changed.

## Implementation and tests

- [Recovery transactions](../../../packages/client/src/modules/command-recovery.ts), [artifact retention](../../../packages/client/src/modules/artifacts.ts), [journal guard](../../../packages/client/src/modules/storage.ts).
- [Review interface](../../../packages/shell/src/features/modules/views/command-correction.tsx), [custom-view integration](../../../packages/shell/src/features/modules/views/queued-commands.tsx).
- [Nine recovery checks](../../../tests/unit/command-recovery.test.ts), [shared real-client journey](../../../tests/support/command-correction-journey.ts), [browser runner](../../../tests/e2e/command-correction.spec.ts), [native runner](../../../tests/desktop/command-correction.spec.ts).

## Verification

- `pnpm build`: strict root/browser/Node/preload/worker checks, boundaries/copy checks and four fresh builds passed. Final log `/tmp/gabs-command-correction-build-final3.log`; existing bundle-size warnings remain.
- `node /tmp/gabs-host-ui-browser-isolated.mjs exec vitest run`: **500 tests across 84 files passed** against a fresh migrated/seeded PostgreSQL database. `/tmp/gabs-command-correction-full.log`. This run precedes the final presentation-only fix to the read-only review's saved-state message; recovery/runtime code is unchanged afterward. Final build and both real-client runs include that fix.
- Final browser run: `node /tmp/gabs-host-ui-browser-isolated.mjs exec playwright test tests/e2e/command-correction.spec.ts tests/e2e/queued-commands.spec.ts tests/e2e/review-drafts.spec.ts`. **6/6 passed**; log `/tmp/gabs-command-correction-web-final2.log`.
- Final native run: `node /tmp/gabs-host-ui-browser-isolated.mjs exec playwright test --config playwright.desktop.config.ts tests/desktop/command-correction.spec.ts tests/desktop/queued-commands.spec.ts tests/desktop/review-drafts.spec.ts`: **5/5 passed**. `/tmp/gabs-command-correction-native-final.log`. Windows remained hidden/unfocused; each new journey asserts that condition.
- Both clients exercise rejected, uncertain/cancelled and late-accepted originals, actual offline capture, offline review save, browser reload/native process restart, lost settlement response and another offline restart. They assert exact unchanged original bodies, selected versus untouched unselected children, cancellation preventing a late execution, and duplicate-free effects. Corrected paths yield exactly two records/two audits; late-accepted recovery yields three original records/three audits with no replacement.
- Scoped Axe, keyboard interaction and narrow dialog overflow checks pass. Normal replacement cases also assert page overflow. Captures include wide/narrow reviews and narrow outcomes for all three modes on both clients. Five representative inspected captures are listed below; these are continuity evidence, not final design approval.

## Review corrections

The first unit fixture incorrectly retained custom-view declarations without executable bundles. Its initial five cases failed package validation; a contract-only fixture fixed that setup. Subsequent unit and full runs passed. Initial screenshots were captured before the modal's opening frame; the harness now waits for its open class. Visual review then found a read-only accepted review falsely reporting unsaved dependency choices after those dependents finished. The status now applies dirty checks only while editable, with explicit browser/native assertions. No behavioral gate or timeout was weakened. Twelve modified historical regression captures were restored to their committed bytes; all eighteen new correction captures are retained.

## Representative visual review

- [Browser narrow review](web-rejected-review-narrow.png).
- [Native wide uncertain review](native-uncertain-review.png).
- [Native narrow replacement outcome](native-rejected-result-narrow.png).
- [Native late-accepted retained review](native-late-accepted-result-narrow.png).
- [Browser late-accepted retained review](web-late-accepted-result-narrow.png).

## Required continuation

- [Held-action authority](../command-authority/README.md) now verifies real-client lease expiry and received revocation during delayed settlement replies. Original/current permission declarations across installed releases, schema transitions and profile/sign-out recovery remain required; unit upgrade checks do not substitute for those journeys.
- Cross-module/resource dependents, archive/custom descendants, already-submitted child outcomes and further dependency recovery. Unselected work intentionally remains attached to the cancelled original; reassignment requires a separate explicit flow.
- Reference-aware correction labels/editors, permanent revocation, history retention/large histories and full development simulation of derived references and recovery.
- The previously documented intermittent native linked-create close concern remains unresolved. This milestone does not claim to fix it or complete any broad release gate.
