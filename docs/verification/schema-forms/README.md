# SDK-04: structured schema forms

17 September 2026. This is a scoped SDK-04 milestone, not completion of the SDK or visual-design approval.

## Implementation

- Public `@suite/module-sdk/forms` helpers derive incomplete drafts and schema-validated complete values. Negative compile-time cases cover nested numeric values, unknown fields, tuple positions and form ordering.
- `TypedSchemaForm` is available through the public host UI kit to independently built modules. It covers nested objects, bounded homogeneous arrays, nullable values, primitive literal choices and union branches. Validated JSON fields handle records and other structured schemas without a specialized control.
- Invalid raw JSON survives unrelated edits and blocks submission. Defaults are cloned and validated. Falsy literals retain their original types. Field issues use JSON Pointer paths.
- Existing boolean fields remain checkboxes. Date inputs are selected by declared schema rather than substrings in field names. Corporate configuration actions honor form validity.
- Custom-view dropdown portals remain in their Shadow DOM container and inherit the view's host styles. Existing application layout and theme tokens remain in place.

The acceptance module is `tests/fixtures/schema-editor`. Its view imports only public SDK/host contracts and sends the schema-inferred result through the generated resource client.

## Acceptance record

- 25 focused tests passed in five files: schema forms, SDK types/contracts, module simulator, module scenarios and module CLI. Final source passed strict TypeScript, boundaries/copy checks and all four builds.
- 21 distinct targeted Chromium journeys passed across correction runs: structured forms, three development-preview journeys, four generated/custom editor update cases, eleven platform cases, personal local actions and device-fleet recovery. Browser runs were headless. The final structured-form run passed in 8.9 seconds after review corrections.
- Four distinct native Electron journeys passed: two generated-editor recovery cases, an independently installed custom view, and the new structured form. The new form checked the exact persisted PostgreSQL JSON, data survival after reload, and that the window remained unfocused and hidden or minimized. The fixture publisher now handles resource-only client packages without expecting an unnecessary server executable.
- Scoped Axe A/AA checks and the 390px overflow assertion passed. Wide/narrow browser screenshots were visually inspected. The narrow capture waits for the open dropdown to finish its transition; closed retained popups are excluded from that assertion.

### Regressions and test corrections

The first broad run found that changing existing boolean fields into selects broke local-action interaction. Existing checkbox behavior was restored and the local journey passed. Review also corrected reference-map own-property lookup, union-selection clearing and stale branch indices, stable array-row identity, and schema errors on JSON editors.

Lifecycle traces showed that initial provisioning and later release updates were being asserted against the default five-second element timeout. Update tests now finish initial provisioning before changing policy or manipulating clocks; actual staged-update assertions allow 15 seconds and initial installation 30 seconds. Values, receipt identity, failed-conversion recovery, dependency checks and all business assertions remain unchanged. These are functional synchronization deadlines, not the separate load-test budgets.

Remote runs `35157319171` and `35157828146` each passed 81 browser cases and all three unsigned packaging jobs but failed the fleet test. The latter trace showed Contacts being removed successfully while Projects was still in a failed initial installation. The test now verifies Projects is installed before asserting that dependency removal is prohibited. That corrected fleet journey passed locally in 23.0 seconds. Fresh full remote acceptance remains required; load/restore were not reached in those remote runs.

### Captures

- [Wide structured form](wide.png)
- [Narrow form with an open contained dropdown](narrow.png)
- [Native form, upper viewport](electron.png)
- [Native form, lower viewport and accepted result](electron-bottom.png)

Native screenshots use viewport captures because offscreen pixels of a tall element are not reliably painted by a hidden Electron window. No native window was shown or focused for capture.

## Limits and next work

Generated tables, schema-derived documentation generation, filtering/pagination, recursive reference lookup and wider schema composability remain active SDK-04 work. JSON fallback is functional validated editing, not a claim of specialized UI for every TypeBox construct. The root form contract is an object. Browser Axe checks do not establish complete accessibility conformance or replace assistive-technology testing. Native development acceptance does not establish signed packaged release readiness.
