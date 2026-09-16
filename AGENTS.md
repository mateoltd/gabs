# Project execution

- Run browser E2E headless and desktop E2E minimized without taking focus or opening Dock windows. Preserve the default minimized test configuration so the user can keep using their computer. Ask before any acceptance step that genuinely requires an interactive foreground window.

## Parity goal and continuity

- Current user direction: resume feature parity after the GitHub checkpoint. Preserve existing UI while completing functionality; the current UI is not user-approved as polished or acceptable. After every parity acceptance gate is verified, complete the parity goal and create the separately authorized UI refinement goal described in `docs/ui-refinement-goal.md`. Do not start that second goal early. Reconciliation evidence is historical, not a final design approval.

- Preserve the approved product vision in `docs/product-vision.md`. This is a modular business platform, not a two-module application.
- At the start of implementation, read `docs/parity-tracker.md` and the relevant rows of `docs/requirement-ledger.md`. Resume the next ready item; do not restart completed work.
- Use stable tracker IDs in implementation notes. Keep one primary item active unless genuinely independent work justifies more. Update status, acceptance evidence, dependencies and the handoff after meaningful progress.
- Keep original requirement mappings in the ledger. When a gap closes, update both the tracker and ledger, and record actual verification in `docs/verification/README.md`. Historical test counts do not verify subsequent changes.
- Mark work verified only after its observable acceptance criteria pass. Code existence, mocks, simulator results, unsigned packaging and provider configuration alone do not establish production acceptance.
- Track missing implementation separately from external dependencies. Continue independent authorized work when one item is blocked. Never silently defer a requirement, weaken an acceptance gate or mark the overall parity goal complete while required work remains.
- Keep tracker changes focused. Do not add production-facing placeholders to represent unfinished features. Do not run CI or tests for documentation-only tracking updates; validate links, task dependencies and coverage instead.
- Preserve unrelated work. No production deployment, live financial effects, external messages or release publication is authorized merely by the parity goal.
