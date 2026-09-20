# Group administration

Scope: **GOV-01**, **ORG-003**, with supporting permission-matrix and module-local explanation acceptance. This closes the concrete group-editor gap. Employee administration, combined organization-scale testing and provider/platform gates remain open.

## Implemented behavior

The Groups section offers searchable selection and one active editor. New groups receive distinct default names; administrators can rename groups, edit metadata labels, select roles, assign module policies and remove groups. Removal returns keyboard focus to Add group. Selection changes preserve all draft edits; only Save organization submits the policy.

Comma-separated permission inputs are replaced by explicit Allow, Deny and Not set decisions. Groups and tags share `organization/permissions.tsx`; their editor components retain their own data and membership behavior. Existing saved decisions remain selectable for removal even if absent from the current permission choices. Names remain bounded by the existing schema. No server schema, authority rule, package contract, theme or CSS changed.

The matrix previews unsaved policy while module-local review uses the accepted server policy. Denials still override ordinary grants. Invalid root denial is rejected without losing the draft or changing saved state. Group metadata labels do not become independent permission policies.

## Verification

Verified locally on 20 September 2026:

- **27 focused checks across five files** passed: architecture boundaries, SDK role tags, PostgreSQL tag admission, capability review and module-policy assignment. Log: `/tmp/gabs-group-editor-focused.log`.
- Strict root/browser/Node/preload/worker checks, dependency/copy checks and **four fresh build targets** passed for the final production code: `/tmp/gabs-group-editor-build.log`. After extending the acceptance fixture, strict checks passed again: `/tmp/gabs-group-editor-final-types.log`. Existing bundle-size warnings remain.
- The new group journey and three affected regressions passed in headless Chromium and hidden/minimized Electron: role tags, group/tag module assignment and chart classification. Logs: `/tmp/gabs-group-editor-web.log`, `/tmp/gabs-group-editor-web-current.log` and `/tmp/gabs-group-editor-native.log`. The first browser group attempt used an incorrect expected source-label prefix; the corrected expectation follows the existing evaluator, with no production change to source labels.
- The expanded final group journey passed again in **both clients**, including a 100-group organization: `/tmp/gabs-group-editor-capacity-web.log` and `/tmp/gabs-group-editor-capacity-native.log`. It selects and edits the last group, persists/reloads its decision, verifies exactly one active editor, and compares all other 99 groups and the complete hierarchy unchanged.
- The ordinary journey covers distinct draft names, search, metadata preservation, multiple roles, conflicting group decisions, explicit decision removal, rename, rejected root denial, draft/server separation, saved reload, keyboard removal and agreement with module-local review. The module-policy regression preserves independent direct grants after group removal.
- Scoped Axe WCAG A/AA and narrow-overflow checks passed. All eight final captures below were inspected. Native assertions confirm every window remains unfocused and hidden or minimized. Test databases were removed; incidental historical screenshots were restored.
- Scoped formatting, whitespace and documentation link checks passed. The ledger retains 29 original requirement IDs and the tracker 106 stable IDs.

These are local development-authentication journeys. They do not establish actual-provider, signed-platform, whole-product accessibility or full 500-role/100-group/100-tag combined scale acceptance. No final UI-polish approval or overall parity completion is claimed.

## Inspected captures

| Client | Editor | Decisions |
| --- | --- | --- |
| Web | [Wide](web-top.png) | [Wide](web.png) |
| Web, narrow | [Narrow](web-narrow-top.png) | [Narrow](web-narrow.png) |
| Desktop | [Wide](desktop-top.png) | [Wide](desktop.png) |
| Desktop, narrow | [Narrow](desktop-narrow-top.png) | [Narrow](desktop-narrow.png) |
