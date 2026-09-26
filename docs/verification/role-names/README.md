# Role names and organization recovery

Scope: GOV-01 / ORG-003 with supporting ORG-002 and PERM-001/PERM-002. This closes the role/chart naming implementation gap; wider governance and release acceptance remain open.

## Behavior and ownership

Role metadata owns display names. The server updates an existing saved chart and advances its revision in the same transaction as a role rename, audit, outgoing event and idempotency receipt. Permission-only edits and accepted retries do not advance the chart revision. Positions, reporting relationships, inheritance, groups, tags and module assignments are preserved. The protected Administrador root retains its required display name; whitespace-only and reserved custom role names are rejected.

Chart reads project current metadata over stale labels left by older application versions, without hidden database writes. Chart saves persist authoritative labels, including the first save after a rename. Stale versions are rejected. Module-local capability explanations also use current role names rather than stale chart labels.

Organization retains unsaved edits after a conflict and disables saving and permission previews until explicit reload. A failed reload retains the draft and recovery action. A successful reload replaces it with the current organization and restores keyboard focus. The existing UI components and styling remain in use.

## Verification

- Full isolated unit/PostgreSQL regression: 1,061 tests across 140 files passed on final source.
- Strict TypeScript in all five environments, boundary/copy checks and all four fresh application builds passed.
- Four headless browser journeys and four hidden/minimized native journeys passed: renames, role-edit recovery, role removal and organization diagnostics. The affected rename journey was rerun successfully in both clients after the final focus/error-copy corrections.
- All eight final captures were inspected, including wide conflict/recovery states and narrow failed-read recovery.
- Database cases cover same-key replay, permission-only edits, legacy labels, the first chart save, competing saves, protected labels, trimmed names and exact preservation of chart content.
- Product journeys cover stale drafts, disabled permission previews, failed reload preservation, explicit successful replacement, keyboard focus recovery and actual People-to-chart renames. Scoped Axe A/AA checks and narrow overflow checks pass.

The first native run passed three of four cases and exposed animation-frame-dependent focus restoration in hidden windows. The corrected state-driven focus restoration passes all four native journeys. Reload errors now use plain-language copy instead of desktop transport implementation details. No schema migration or public API change is required.

## Captures and reproduction

| State | Web | Hidden desktop |
| --- | --- | --- |
| Concurrent rename conflict | [Capture](web-conflict.png) | [Capture](desktop-conflict.png) |
| Failed reload retains draft | [Capture](web-reload-failed-narrow.png) | [Capture](desktop-reload-failed-narrow.png) |
| Current chart recovered | [Capture](web-recovered.png) | [Capture](desktop-recovered.png) |
| People rename reflected in chart | [Capture](web-people-renamed.png) | [Capture](desktop-people-renamed.png) |

Authoritative tests: `tests/integration/role-edits.test.ts` and `tests/integration/capability-review.test.ts`. Shared product journey: `tests/support/role-names-journey.ts`, exercised in web and hidden Electron clients. Ephemeral logs: `/tmp/gabs-role-names-build-final.log`, `/tmp/gabs-role-names-web-final.log`, `/tmp/gabs-role-names-native-final.log`, `/tmp/gabs-role-names-regression.log`, `/tmp/gabs-role-names-web-copy.log` and `/tmp/gabs-role-names-native-copy.log`.

## Limits

This does not establish provider, signed-platform, whole-product accessibility or full parity acceptance. The later UI refinement goal has not started.
