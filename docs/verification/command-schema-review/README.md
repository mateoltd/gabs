# Saved command reviews across schema changes

Status: OFF-01-SCHEMA locally verified, 19 September 2026. Full OFF-01 and product parity remain incomplete.

## Problem and change

A saved review could retain fields removed by a later signed module release. Closed-object form controls rendered only current fields while validation correctly rejected the retained extra properties. The user could inspect the old review but could not produce a valid correction through the form.

The shared schema form now displays unsupported saved fields, including nested ones, as read-only values with explicit per-field removal from the draft. It never strips values on load, changes the original request, or submits a correction automatically. Existing pattern/map editors retain their own key controls. Required fields and server validation remain authoritative. Labels use the same shared helper without introducing a form/table import cycle; public UI exports and styles are unchanged.

## Observable journey

The test publishes and installs three independently signed releases through the registry:

1. Capture an original command and selected/unselected dependents under release 1; preserve its rejection and original identity.
2. Release 2 changes command permissions and requires a reason plus a nested context. Verify original/current permission boundaries, then explicitly save a review with the additional values.
3. Release 3 removes the reason and one nested context field, retains the other context field and requires a new explanation.
4. Restart offline. Inspect the release-2 review and original release-1 request. Current validation reports both obsolete fields. Explicitly remove each obsolete draft field, including with the keyboard; unrelated input stays intact.
5. Close without saving and restart. The full release-2 review returns. Repeat the edits and explicitly save; another offline restart restores the complete release-3 review. No server records exist yet.
6. Reconnect and approve correction. The original is fenced before a new identity is submitted. Only the selected dependent continues with its exact release-1 body. Repeating the accepted correction leaves exactly two records and two creation audit entries.

## Verification

- Initial harness execution exposed an optimistic-version mistake in the second rollout. The harness now reads the current platform setting version; server validation was preserved.
- The corrected baseline reproduced the missing removal control on unchanged product source: `/tmp/gabs-schema-review-before-final.log`.
- The first corrected complete headless browser journey passed: `/tmp/gabs-schema-review-web-focused.log`.
- Strict environment/boundary checks and four fresh builds passed before the final wording and expanded validity/keyboard assertions: `/tmp/gabs-schema-review-build.log`.
- Final-source strict root/browser/Node/preload/worker checks, dependency/copy checks and four fresh production builds passed: `/tmp/gabs-schema-review-final-build.log`.
- All 554 unit/PostgreSQL tests across 89 files passed: `/tmp/gabs-schema-review-regression.log`.
- Eight headless browser journeys passed together: rejected/late-accepted commands, two- and three-release reviews, development/installed tuple-map forms, nested references and generated structured forms. Log: `/tmp/gabs-schema-review-web-acceptance.log`.
- Three hidden/minimized, unfocused native journeys passed together: rejected commands, existing upgrade recovery and the new three-release review. Log: `/tmp/gabs-schema-review-native-acceptance.log`.
- Scoped Axe and horizontal-overflow checks passed. Eight final wide/narrow browser/native captures were inspected, covering unsupported nested/root fields, reachable removal controls and restored current review input. Scrollable dialogs preserve access to lower content. This is functional continuity evidence, not final UI polish or whole-product AAA conformance.
- Historical captures overwritten by regression runs were restored. No production styles, signed release artifacts, permission semantics or original request bodies changed.

## Limits

This proves three-release command-review recovery for removed top-level and nested object fields. It does not establish every schema type conversion, legacy unsigned/missing-contract recovery, archive/update descendant review, submitted-child outcome, profile-removal recovery or entire OFF-01 completion. Full parity and the later UI-refinement goal remain open.
