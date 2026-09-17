# SDK-04: structured tables and authorized reference labels

17 September 2026. Scoped framework acceptance; SDK-04, platform parity and final UI approval remain open.

## Implemented behavior

- Local workspaces now use the public typed table instead of string-coercing records. Arrays, tuples and maps expand into their fields, retain schema titles and preserve false/zero/null/unset distinctions. Standalone tables page through 50 records at a time.
- `TypedResourceTable.loadReferences` resolves displayed annotated links through the same public loader as forms. It deduplicates target/UUID pairs, uses explicit selected-ID lookup beyond the first page and limits concurrency to four requests. Hidden columns and custom-rendered cells do not cause lookups.
- Old batches cannot publish results after the loader, identifiers or retry attempt changes. A learned authorization denial clears all labels for the affected target, including responses already in flight, while unrelated targets continue. Loading, missing-cache and unavailable states remain distinct; failures have an actionable retry.
- Generated tables share account/workspace-scoped leased caches. A denial learned by a picker invalidates mounted table consumers too. Custom-view clients renew their identity on host authorization/connection changes; development clients also track simulated grants, memberships and provider permissions.
- An independent signed fixture proves public composition without editing host routes, navigation registries or module unions. A separate encrypted local-profile fixture uses real signed installation and worker execution before the UI browses 51 records offline.
- The public table now preserves the existing 180px minimum first-column width inside custom views as well as generated views. Narrow tables remain bounded to their scroll container and support keyboard horizontal scrolling. Other layout and theme rules remain in place.

## Corrections found during acceptance

The first permission race exposed a stable development client retaining old lookups after simulated permissions changed. The preview and installed clients now renew with their authorization context. Review also added target-wide denial invalidation so a single rejected lookup cannot leave sibling labels visible. Interface inspection found record names squeezed into partial words on narrow screens; the shared minimum width and keyboard scroll checks address that directly.

Fixture corrections used the API's actual `{ data }` mutation envelope, scoped Axe to the Shadow DOM host, compiled the seed worker at its actual URL and used the offline entry screen's **Open local profiles** action. The permission-restoration journey refreshes the records because the host can already have reauthorized and removed the retry button. A separate injected-denial journey verifies the retry button itself. No schema, permission or performance acceptance rule was relaxed.

## Verification

- `pnpm build`: strict type checks, boundary/copy checks and all four builds passed (`/tmp/gabs-table-labels-build4.log`).
- Full suite: **209 tests across 43 files passed in 50.77 seconds**, using a temporary migrated/seeded PostgreSQL database removed afterward (`/tmp/gabs-table-labels-full.log`). The shared development database was preserved.
- **13 distinct headless browser journeys passed**: three new table journeys in 25.9 seconds (`/tmp/gabs-table-labels-browser5.log`) plus ten editor/update/suspension/list/reference/map regressions in 4.5 minutes (`/tmp/gabs-table-labels-regressions.log`). A final installed-table rerun in 16.5 seconds explicitly checked keyboard horizontal scrolling and captured the end columns (`/tmp/gabs-table-labels-keyboard.log`).
- **Three hidden/unfocused Electron journeys passed in 34.7 seconds**: independent table labels, generated resource lists and encrypted local-worker restart (`/tmp/gabs-table-labels-native.log`). The new journey explicitly asserts hidden/minimized and unfocused state at both ends.
- Scoped Axe reported no violations for the installed custom-view host. Permission races, denied cache recovery, selected IDs beyond the first 100 targets, archival, retry, exact persisted values and offline paging through 51 records have observable assertions. These are scoped checks, not whole-product accessibility approval.
- Seven captures were inspected: [wide](wide.png), [narrow](narrow.png), [keyboard-scrolled end columns](narrow-end.png), [generated](generated.png), [local structured values](local.png), [offline second page](local-page.png) and [Electron](electron.png). Seventeen overwritten historical captures were restored.

Prior `d1941d9` / [CI 35177252607](https://github.com/mateoltd/gabs/actions/runs/35177252607) passed 207 unit/PostgreSQL tests, all 90 browser journeys, strict/build, three unsigned package commands and a three-second logical restore. The unchanged load gate failed at p95 626 ms reads and 1,437 ms confirmations against 500/1,000 ms budgets. Every artifact upload failed account storage quota. This is evidence for the preceding editor checkpoint; remote acceptance of the table changes remains pending.

## Limits

The SDK still needs richer query controls, wider composition and resource-client ergonomics. Cross-module local capabilities remain SDK-05 work; standalone custom view mounting remains open. Multiple target annotations at the same value path display an explicit ambiguous state and need a custom cell. Lookup concurrency is bounded, but total work still depends on the displayed reference count; no large-dataset or load-budget acceptance is claimed here. Scoped Axe and screenshots do not replace manual assistive-technology or whole-product theme acceptance. Hidden development Electron does not establish signed release readiness.
