# Module policies across reviewed releases

Scope: **GOV-01**, **ORG-003**, **ORG-001** and **ORG-006**. This continues [group/tag module assignment](../module-policies/README.md) across dependency changes and pinned releases. It preserves the existing application UI.

## Behavior and ownership

- Registry publication advances a database revision only when a new release is inserted. Duplicate publication does not advance it. A tenant-isolated cursor records each workspace's adopted revision.
- Authenticated bootstrap and policy delivery reconcile previously approved group/tag intent under the workspace lock. Assignments, cursor and audit commit together. Repeated and concurrent reads do not duplicate assignment-change audit records. Publications racing with reconciliation remain eligible for the next refresh.
- Current-policy provenance filters stale derived access even before reconciliation. Removing a release dependency removes derived access while preserving independent direct grants. Pins retain their dependency set until explicitly changed.
- Seat allocation preserves existing eligible assignments. Already accepted requests may remain pending without blocking unrelated edits. New assignments still require capacity; leaving a role frees seats for waiting members. Billing recovery can admit pending intent.
- Policy interpretation and source explanations belong to server governance's `module-policy`; assignment mutation belongs to `module-assignments`; durable adoption belongs to `module-policy-refresh`. API routes orchestrate these public server entry points. The shell invalidates member and role queries when policy changes arrive, and uses registry names for independently published modules.

## Verification

Checkpoint `4521b77` preserves the implementation and initially unfinished acceptance fixtures before the requested Sol xhigh review. [The architecture review](../architecture/README.md#policy-release-checkpoint-review-20-september-2026) records the independent delegate and parent findings.

Verified locally on 20 September 2026:

- **1,016 tests across 132 files passed** against an isolated migrated PostgreSQL database: `/tmp/gabs-policy-architecture-regression-final.log`. This includes all 14 architecture boundary fixtures. The nine focused PostgreSQL checks also pass: `/tmp/gabs-policy-architecture-focused-final.log`.
- Strict root/browser/Node/preload/worker checks, dependency/copy checks and **all four fresh build targets** pass on the final source: `/tmp/gabs-policy-architecture-accepted-build.log`. Existing bundle-size warnings remain.
- **Two final headless browser journeys passed**: the new release-transition journey and the existing module-policy regression. Log: `/tmp/gabs-policy-architecture-web-accepted.log`.
- **Two final hidden/minimized native journeys passed**, including explicit unfocused/hidden-or-minimized window assertions. Log: `/tmp/gabs-policy-architecture-native-accepted.log`. All isolated test databases were removed.
- Scoped Axe and narrow overflow checks pass. All four new captures were visually inspected; final reruns reproduced the same image hashes. Incidental historical capture changes were restored.
- Source formatting and whitespace checks pass. Documentation links pass; the ledger retains 29 original requirement IDs and the tracker 106 stable IDs.

The first full run passed 1,015 tests and failed the new unavailable-release fixture because deleting every registry version intentionally activated the development catalog fallback. The corrected fixture pins an existing release through the API, removes only that version, and keeps other signed candidates. This exposed the eager permission-catalog lookup fixed in parent review. Earlier browser runs exposed a fixture deadline below the 15-second delivery cadence and a real missing member-query invalidation; both were corrected. No authorization rule or UI visibility constraint was weakened.

The integration scenario covers signed dependency removal/addition, concurrent refresh after API restart, exactly-once assignment-change audits, duplicate publication, pending seats, unchanged/renamed policies, direct admission with obsolete inherited rows, role removal and failed reentry, billing recovery, pins, unavailable pinned releases, revoked-member cursor protection and app/worker database privileges. The client journeys exercise actual background policy delivery, visible member refresh, source names, independent direct grants, pin/unpin and reload persistence. Scoped Axe and narrow overflow assertions are included.

Acceptance uses development identity, local signing keys, an isolated PostgreSQL database and compiled Electron output. It does not establish actual identity/billing-provider acceptance, signed production packaging or physical platform durability.

## Captures

| Surface                | Web                              | Desktop                              |
| ---------------------- | -------------------------------- | ------------------------------------ |
| Current policy sources | [Wide](web-sources.png)          | [Wide](desktop-sources.png)          |
| Narrow member dialog   | [Narrow](web-sources-narrow.png) | [Narrow](desktop-sources-narrow.png) |

The captures show actual scrollable viewport positions. This is functional continuity evidence, not final UI approval.

## Remaining work

GOV-01 remains active for chart classification filters/autocomplete and broader employee/group administration. Registry-wide recovery for edits that require permission-catalog validation while an unrelated module contract is unavailable is also open; this review covers edits whose requested permissions are already held. Large organizations, actual provider events, signed target-platform releases and broader rollout/recovery acceptance remain separate gates. Full parity and the later UI-refinement goal remain open.
