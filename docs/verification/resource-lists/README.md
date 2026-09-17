# SDK-04 typed resource lists

17 September 2026. This milestone preserves the existing host presentation while extending generated list behavior. It does not establish full SDK-04 completion, final UI approval or release readiness.

## Implemented

- `ResourceListOptions<Data>` infers equality filters from each resource's schema. Corporate execution, standalone execution and simulation validate the same bounded list envelope and actual field values. PostgreSQL uses bound parameters and full JSON field equality after authorization and namespace checks.
- Public `TypedResourceTable` and `TypedResourceFilters` compose schema-derived rows, columns, custom cells, actions, reference labels and editors. Falsy/null/absent values stay distinct. Structured values expand with the keyboard and render text without HTML interpretation. Own-property lookups protect unusual field names.
- Generated lists offer removable filters, first/previous/next navigation, page numbers and 10/25/50/100 page sizes. Filter/resource/search/page-size changes reset paging. Empty, loading, failed and offline states remain separate.
- Durable page caches include the normalized full query. Equivalent AND filters reuse the same cache regardless of field insertion order. Legacy unfiltered default-size pages remain readable. A real disconnect test exposed a stale in-memory cache snapshot; query completion and connectivity changes now refresh it from durable storage.

## Verification

Verification completed on the final build:

- Strict TypeScript, boundary/copy lint and all four application builds passed.
- 50 focused SDK, runtime, simulator, local-worker, documentation and client tests passed.
- 18 distinct headless journeys passed across correction runs. The broad run passed 15/16; the offline setup case passed after waiting for the real initial installation. The final four-case run passed activation, fleet recovery, queued offline capture and resource lists, including numeric zero and normalized offline filters.
- The final minimized native journey passed in 13 seconds. Its window remained hidden/minimized and unfocused; renderer Node globals remained unavailable.
- Scoped Axe checks found no A/AA violations in the generated resource surface; 390-pixel viewport overflow checks passed. Wide, narrow and native images were inspected. This is not a whole-product accessibility-conformance claim.

Local logs: `/tmp/gabs-resource-final-tests.log`, `/tmp/gabs-resource-final-build.log`, `/tmp/gabs-resource-browser-regressions.log`, `/tmp/gabs-resource-browser-final.log`, `/tmp/gabs-resource-native-final.log`.

The remote runs at `d6ef4fc` (`35161075683`) and `6cf68d6` (`35162367227`) each passed 81 browser cases and all three unsigned packaging jobs, but failed two outdated setup assumptions. Activation now asserts the invalid-configuration button is disabled and separately verifies server rejection. Fleet acceptance explicitly resumes Projects when its dependency download was deliberately interrupted, before asserting dependency-removal rejection. Local corrections passed. The subsequent `f701463` / [CI 35165655671](https://github.com/mateoltd/gabs/actions/runs/35165655671) passed all 180 unit and 84 browser cases, all three unsigned packages and a two-second logical restore. Load remained over the unchanged 500/1,000 ms targets at 854/1,788 ms. No performance budget was changed.

| Surface                    | Evidence                                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Typed contracts and values | `tests/resource-lists.test.ts`: inferred filters/columns/cells, malformed envelopes, full nested equality, null/missing/falsy distinctions, stable paging, isolated results, transported schemas, simulator/local execution, unusual keys and escaped output |
| PostgreSQL and API         | `tests/module-platform.test.ts`: filtered paging, escaped search, invalid fields/types/bounds, workspace isolation; existing authorization and mutation checks retained                                                                                      |
| Web                        | `tests/e2e/resource-lists.spec.ts`: independent signed test package, real API writes, typed generated filters, paging, keyboard expansion, scoped Axe, offline downloaded/uncached pages and narrow-screen interaction                                       |
| Electron                   | `tests/desktop/resource-lists.spec.ts`: independent signed test package, authoritative IPC writes and the same generated list journey; hidden/minimized/unfocused window and absent renderer Node globals asserted                                           |
| Regressions                | Generated Contacts/Projects, offline writes, draft identity, uncertain receipts, local profiles, structured addresses and open-editor update recovery                                                                                                        |

Visual artifacts: [wide web](web-wide.png), [narrow filter](web-narrow.png), [narrow filter actions](web-narrow-filter-actions.png), [narrow paging](web-narrow-pagination.png), [minimized Electron](electron.png). These are inspected engineering evidence, not user acceptance of the overall design. Browser runs are headless; native runs retain `SUITE_DESKTOP_TEST_MINIMIZED=1` and do not take focus.

## Limits

Equality filters match complete field values, with at most 16 fields. Page sizes are 1–100 and ordering is ascending ID. Pagination is not a database snapshot. Locale-sensitive free-text search can differ between PostgreSQL and JavaScript. See [the authoring guide](../../module-resource-lists.md).

Recursive reference discovery, paginated reference lookup, richer sort/range controls, remaining composition/component acceptance, assistive-technology testing, general offline working-set bounds and broader platform/release gates remain open. Fixture registry publication is local acceptance work; no hosted release or live commerce effect occurred.
