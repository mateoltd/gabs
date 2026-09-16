# Project execution

## Parity goal and continuity

- Current user direction: feature-parity implementation is paused for UI reconciliation. Reconciliation evidence is recorded in `docs/ui-reconciliation.md`; wait for user direction before resuming any parity task. Preserve the established UI in `docs/ui.md`; functional expansion is not permission to replace its visual system. New UI must use its shared geometry, controls, navigation and motion, and be visually checked in web and Electron.

- Preserve the approved product vision in `docs/product-vision.md`. This is a modular business platform, not a two-module application.
- At the start of implementation, read `docs/parity-tracker.md` and the relevant rows of `docs/requirement-ledger.md`. Resume the next ready item; do not restart completed work.
- Use stable tracker IDs in implementation notes. Keep one primary item active unless genuinely independent work justifies more. Update status, acceptance evidence, dependencies and the handoff after meaningful progress.
- Keep original requirement mappings in the ledger. When a gap closes, update both the tracker and ledger, and record actual verification in `docs/verification/README.md`. Historical test counts do not verify subsequent changes.
- Mark work verified only after its observable acceptance criteria pass. Code existence, mocks, simulator results, unsigned packaging and provider configuration alone do not establish production acceptance.
- Track missing implementation separately from external dependencies. Continue independent authorized work when one item is blocked. Never silently defer a requirement, weaken an acceptance gate or mark the overall parity goal complete while required work remains.
- Keep tracker changes focused. Do not add production-facing placeholders to represent unfinished features. Do not run CI or tests for documentation-only tracking updates; validate links, task dependencies and coverage instead.
- Preserve unrelated work. No production deployment, live financial effects, external messages or release publication is authorized merely by the parity goal.
