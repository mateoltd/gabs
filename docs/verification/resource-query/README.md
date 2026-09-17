# SDK-04: reusable resource query state

17 September 2026. Scoped framework acceptance; SDK-04, full parity and final UI approval remain open.

## Implemented behavior

- `ResourceClient<Data>` retains schema inference while providing stable per-resource clients and reference loaders within a module client. Separate module/host contexts get separate clients. Unknown resource names fail explicitly.
- `get` and `list` accept read request options, reject pre-aborted dispatches, and reject cancelled results even from an adapter that ignores cancellation. The corporate custom-view transport forwards read signals to HTTP. Mutation signatures and idempotency keys remain unchanged.
- Public `useResourceList` infers query conditions and row data. Its four discriminated states distinguish idle, loading, success and error; only success has a page. It owns cursor history, next/previous/first controls and explicit reload. Equivalent inline JSON queries do not refetch on unrelated renders.
- Query, client and enabled changes reset pagination and mask previous data during render. Superseded reads are aborted and their completions discarded. Errors and pauses expose no old rows as current results. Callers select their offline behavior explicitly; this hook adds no persistent corporate cache or mutation journal.
- The signed-view UI bridge now exposes the hook, ranges, sorting and select controls. The module builder permits public SDK query helpers. Shared toolbar geometry lives in the UI kit. A signed independently published module composes those APIs without a central module registration.
- The existing reference-table fixture now uses explicit `reload()` rather than relying on resource-object allocation to rerun an effect.

## Corrections found during acceptance

A delayed development read could restore the permission snapshot captured before a later revocation. The preview now checks cancellation before applying state and ignores responses older than its latest applied request. The browser test waits for server-accepted revocation, then releases the earlier read and verifies that records remain unavailable until reauthorization. Existing provider and offline simulation journeys remain regression gates.

The initial range-removal fixture selected a bulk-clear action that only exists with multiple ranges; it now uses the actual single-range removal control. Corporate reconnect acceptance explicitly enables its offline lease so the custom view remains available to observe its paused read state. Screenshot inspection also identified a test-publication substitution colliding with a shared CSS class; the fixture identity is separated from that class.

## Verification

- Final strict type checks passed (`/tmp/gabs-resource-query-types-final.log`). Formatting and all 216 checked local documentation links passed. Boundary/copy checks and all four production builds passed (`/tmp/gabs-resource-query-build3.log`).
- **219 unit/PostgreSQL tests across 46 files passed in 53.79 seconds**, using a temporary migrated/seeded database removed afterward (`/tmp/gabs-resource-query-full.log`). Nineteen focused SDK checks also passed in 2.37 seconds (`/tmp/gabs-resource-client-unit.log`), including inferred field rejection, separate client contexts, read cancellation before dispatch and after uncooperative completion, and preserved mutation keys.
- **Twelve distinct headless browser journeys passed.** Two new query journeys passed in 21.0 seconds after the preview-race correction (`/tmp/gabs-resource-query-browser4.log`); ten existing preview/provider/reference/sorting regressions passed in 2.1 minutes (`/tmp/gabs-resource-query-regressions.log`). After fixing the fixture CSS-name collision and capture framing, both new journeys passed again in 21.7 seconds (`/tmp/gabs-resource-query-browser-final.log`).
- Browser acceptance covers explicit reload/retry, current-page history, sort/range/search resets, unrelated input, pause/resume, resource switches, delayed old results, accepted permission revocation, reauthorization, real HTTP cancellation and reconnect with an authorized offline lease. Scoped Axe passed in the installed custom view, and the 390-pixel document has no horizontal overflow.
- **Two hidden/unfocused Electron journeys passed in 28.0 seconds**, covering the new signed custom view and generated sorting (`/tmp/gabs-resource-query-native.log`). The final corrected fixture rerun passed in 15.4 seconds (`/tmp/gabs-resource-query-native-final.log`). Native tests assert hidden/minimized and unfocused windows at both ends and preserve renderer isolation.
- Four final captures inspected: [installed wide](wide.png), [installed narrow](narrow.png), [development preview](development.png) and [Electron](electron.png). Historical captures overwritten by regression tests were restored. Existing preview services and development data were preserved.

## Limits

Cancellation cannot undo already-dispatched desktop IPC or business effects. The hook provides query state, not an offline cache, mutation subscription, aggregate query engine or standalone custom-view runtime. Query serialization follows JSON transport semantics; arbitrary non-JSON objects are outside its contract. Host UI capability/version compatibility, additional schema composition, cross-module standalone access and broad UI-kit coverage remain tracked. Scoped Axe and hidden development Electron do not establish whole-product accessibility, signed release readiness or final UI approval. GitHub Actions execution budget and artifact quota still block remote acceptance; local engineering continues.
