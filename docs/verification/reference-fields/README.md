# SDK-04 recursive resource references

Date: 17 September 2026. Scoped engineering acceptance; SDK-04 and overall parity remain open.

## Implemented

- Public schema traversal derives reference targets and schema/data pointers from authored or transported contracts, including nested objects, collections, nullable values, intersections and matching union branches. Ordinary JSON validation uses own properties, including `constructor` and `__proto__` field names.
- Corporate CRUD validates nested records/members in the current workspace. Record targets must be active; members and their accounts must be active. Cross-module references require dependency declarations, current read permissions, module availability and explicit read grants. Repeated UUIDs are deduplicated; database checks use batches of 500.
- A version-bound `moduleReferences` endpoint returns bounded labels, stable ID cursors and an independently resolved saved selection. The same schema defines the inferred query type, server validation and the desktop bridge's allowed request shape.
- Generated forms and equality-filter editors use searchable, paginated reference controls. Saved selections survive search/page changes, failed requests and offline browsing. Missing labels remain explicit. The host caches at most 200 recently used labels per source version/resource/target, with account/workspace scope and lease checks; a connected lookup rejection evicts that target's retained labels.
- Public form/filter/picker callbacks, reference helpers, resource tables and structured values are available through the independent custom-view bundle interface. A real package build and render checks those exports. Automatic corporate lookup capabilities for independent custom/standalone views remain open.

## Verification

- Strict TypeScript, boundary/copy lint and all four application builds passed.
- All 189 unit/PostgreSQL tests passed across 39 files in the final full run (85.27 seconds), with temporary business diagnostic logging removed afterward.
- Fourteen distinct headless browser journeys passed across correction runs. The broad final run passed 13/14; the remaining reference case passed after correcting its singular/plural assertion. A subsequent final pass also applies a nested-reference equality filter through the actual generated editor. Coverage includes actual Contacts/Projects, profiles, lifecycle repair, offline capture/reload, uncertain receipts, structured forms/addresses, physical counts, notifications, resource filters and all ten principal high-contrast theme pairs.
- The final native run passed both reference and structured-form journeys in 26.7 seconds. The reference test asserts a hidden/minimized, unfocused window and unavailable renderer Node globals.
- The independent reference fixture publishes a signed package without host registration/routing changes, creates 105 target records through the real API or IPC, selects beyond the first page, preserves that selection during another search, assigns a real workspace member and saves nested data authoritatively.
- The web journey checks offline downloaded labels, network failure/retry and label eviction after a simulated 403 transport response. PostgreSQL tests independently verify actual denied permissions/grants, foreign/archived records and inactive memberships. Scoped dialog Axe and 390-pixel overflow checks passed.
- Wide, narrow and native captures were inspected. Native controls retained the host styling; compact picker spacing keeps the wide dialog's Save action visible. This is not final UI approval or whole-product accessibility conformance.

Corrections found during acceptance: migration checks needed a schema containing only their changed top-level references; async option reordering could make the shared select emit a spurious clear; and desktop IPC needed explicit version/query allowance for the new operation. Their regression checks now pass. An earlier full run also had one generic server failure during concurrent Orders draft creation; a diagnostic rerun passed all 26 business tests. Its cause was not established, so it remains an OPS-07 observation rather than a claimed concurrency fix.

| Surface              | Evidence                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Traversal and values | `tests/module-references.test.ts`: nested arrays/maps/tuples, overlapping/discriminated unions, null/absence, transported schemas, escaped pointers and prototype-colliding names      |
| Database authority   | `tests/module-reference-runtime.test.ts`: nested writes/lookups, scopes, active targets, dependency/grant/permission denial, bounded paging, selected labels and 501-target validation |
| API and bridge       | `tests/module-platform.test.ts`, `tests/domain.test.ts`: real versioned lookup responses, literal search, pagination/bounds and restricted native query validation                     |
| Independent bundles  | `tests/module-client.test.ts`: reference helpers and public table/filter/picker/value imports build and render through the shared host interface                                       |
| Web                  | `tests/e2e/reference-fields.spec.ts`: signed fixture, real writes, keyboard choice selection, offline/retry/rejection states, Axe and narrow overflow                                  |
| Desktop              | `tests/desktop/reference-fields.spec.ts`: the same picker journey through real IPC, hidden/unfocused window, authoritative save and renderer isolation                                 |

Visuals: [web picker](web-picker.png), [narrow offline picker](web-offline-narrow.png), [hidden native picker](electron-picker.png), [native saved record](electron.png).

Logs: `/tmp/gabs-references-full-verified.log`, `/tmp/gabs-references-final-build.log`, `/tmp/gabs-references-browser-final.log`, `/tmp/gabs-references-browser-accepted.log`, `/tmp/gabs-references-browser-filter.log`, `/tmp/gabs-references-native-final.log`, `/tmp/gabs-references-business-diagnostic.log`.

## Remaining scope

See [the authoring guide](../../references.md). Tuple/map picker editors, complete nested/off-page table labels, independent-view/standalone/simulator adapters, recursive migration-link reconciliation and private-store/operation-input reference semantics remain open. General working-set limits, richer query controls and complete SDK composition are separate remaining requirements.

The previous `f701463` / [CI 35165655671](https://github.com/mateoltd/gabs/actions/runs/35165655671) passed 180 unit tests, 84 browser cases, three unsigned desktop packages and a two-second logical restore. It failed unchanged 500/1,000 ms load targets at 854/1,788 ms. Fresh remote acceptance for this checkpoint remains pending. No hosted release, live billing effect or production deployment occurred.
