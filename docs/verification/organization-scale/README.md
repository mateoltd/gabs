# Large organization administration

Scope: **GOV-01**, **ORG-003**, with supporting **ORG-002** chart and **PERM-001/PERM-002** policy explanations. This covers one real organization containing 500 roles, 100 groups and 100 role tags. Employee administration and actual provider/platform gates remain open.

## Implemented behavior

The permission matrix searches and pages role columns in groups of eight. Effective permissions are evaluated once per visible role and policy snapshot, using the shared SDK evaluator, rather than once per permission cell. Filtering to one role fits both its permission labels and decisions into a narrow viewport. Group, tag and reporting-parent editors search and page role choices in groups of twenty; changing a visible choice preserves selections on other pages.

The organization chart keeps a navigable viewport, searches for distant roles, pans with arrow keys or a background drag, and uses actual SVG coordinates for node dragging. The minimap covers the complete layout and can move the viewport. Fit chart shows the complete extent; zoom remains relative to the selected frame. Moving a role does not open its configuration dialog. Search focuses the revealed role so Enter opens its reporting editor. Focus uses a local border treatment.

The organization feature owns `chart.tsx`, `matrix.tsx` and reusable `roles.tsx`. Groups and tags retain their own editing state. Public schemas, server authority, shared policy evaluation, UI primitives and theme tokens are unchanged. The later UI-refinement goal has not started.

## Verification

- Strict root/browser/Node/preload/worker checks, dependency/copy checks and **four fresh build targets** passed on the final production code: `/tmp/gabs-organization-scale-build-final.log`. Existing bundle-size warnings remain.
- **27 focused tests across five files** passed: SDK role tags, server admission, module policies, capability review and architecture boundaries. `/tmp/gabs-organization-scale-focused.log`.
- Initial existing browser administration regressions passed. The first combined fixture runs exposed test errors: a nested relative locator, an omitted permission-selection step, immediate `check()` on a server-confirmed control, and a hidden mobile navigation link. Those fixtures were corrected without weakening product assertions or increasing timeouts. Action timeout is now explicitly 15 seconds. The complete browser and native scale journeys then passed.
- **Five final headless browser cases and four final hidden/minimized native cases passed**, including the expanded combined journey, group administration, classification and capability review. Logs: `/tmp/gabs-organization-scale-web-expanded.log` and `/tmp/gabs-organization-scale-native-final.log`. Background panning, minimap input, keyboard focus and single-role narrow fit are included.
- All six final captures were inspected. Visual review corrected the native default SVG focus ring and unnecessary narrow horizontal scrolling. Native windows remained unfocused and hidden/minimized; disposable databases were removed. Incidental historical captures were restored. Scoped formatting, whitespace and documentation checks pass; 29 original ledger IDs and 106 tracker IDs are retained.

The fixture seeds 495 ordinary roles into a disposable PostgreSQL company, then admits the complete organization through the public API. All measured editing uses the actual product: pagination/search, a distant chart role, keyboard configuration, a second parent, pointer movement, group/tag selection, removal of a denial, and a direct permission grant. It verifies that the other 99 groups, 99 tags and unrelated ranks remain exactly unchanged. Reload preserves the accepted result, and module-local review agrees with the central matrix about the group source.

The journey checks eight matrix role columns, twenty role choices, no document overflow, no horizontal scrolling for a single-role matrix, local focus styling, and scoped Axe A/AA results. Captures are inspected below. Desktop runs stay unfocused and hidden or minimized. This is local development-authentication evidence for the stated populated topology, not a hosted latency benchmark, all possible dense DAGs, actual-provider/signed-platform acceptance, whole-product accessibility or final UI approval.

## Captures

| Client | Distant role | Permission decision | Narrow decision |
| --- | --- | --- | --- |
| Web | [Chart](web-chart.png) | [Matrix](web-matrix.png) | [Narrow](web-matrix-narrow.png) |
| Desktop | [Chart](desktop-chart.png) | [Matrix](desktop-matrix.png) | [Narrow](desktop-matrix-narrow.png) |
