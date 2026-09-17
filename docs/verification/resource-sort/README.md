# SDK-04: typed resource sorting

17 September 2026. Scoped framework acceptance; SDK-04, full platform parity and final UI approval remain open.

## Implemented behavior

- Schema-inferred `ResourceOrder<T>` supports three scalar priorities with ascending/descending direction. Shared validation rejects invalid names, duplicates, mixed/structured fields and malformed cursors. Numbers compare numerically, booleans false/true, and text by Unicode code point. Null, missing and incompatible retained values come last in both directions; UUID breaks ties.
- Corporate execution uses authorized, parameterized SQL and a saved keyset boundary. Removing or archiving the boundary record does not prevent continuing. Sorted cursors are bound to actor, workspace, module version, resource and canonical query. Existing unsorted UUID pagination remains compatible.
- Resource cursors use AES-256-GCM with fresh random nonces and authenticated scope. A separately HKDF-derived HMAC key provides a stable cache identity for the same boundary, avoiding offline cache misses when encryption produces a fresh token. The server verifies the complete token and identity. Existing private-store token format remains unchanged. Production requires the existing shared cursor secret.
- Standalone and simulator clients use the shared evaluator with query/contract-scoped local cursors; standalone host namespaces also include the profile. Local encodings do not provide corporate authentication. Cursors have explicit size limits and correction messages.
- The public `TypedResourceSort` control supports priorities, direction, keyboard reordering, removal and reset. It composes with equality/range controls in the existing compact toolbar. Corporate downloaded pages include normalized sorting and stable cursor identity. Undownloaded sorts remain explicitly unavailable offline. Local switching clears query controls and page history before evaluating the new resource.

The cryptographic implementation uses the standard APIs documented in [Node.js crypto](https://nodejs.org/api/crypto.html). Separate key derivation and authenticated encryption follow the relevant guidance in [OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html). This is implementation evidence, not an independent cryptographic review.

## Regressions corrected

Prior checkpoint `0f05b97` / [CI 35179410609](https://github.com/mateoltd/gabs/actions/runs/35179410609) completed with 209 unit/database tests and 88 browser journeys passing, five browser journeys failing. Load and restore were skipped after browser failure. All three unsigned packaging commands passed; artifact uploads failed at the account storage quota.

- Three personal-module dialogs failed the existing 390-pixel no-overflow assertion. They reproduced locally: a visually hidden table action label escaped its scrolling container, widening the document to 666 pixels. Establishing the scrolling region as its positioning container reduced the measured document to 390 pixels. The shared UI kit now owns this table-scrolling rule, including development previews. Existing overflow assertions remain unchanged.
- The reference-provider preview test tried to click a retry button while automatic permission refresh removed it. It now observes successful reauthorization and subsequent denial directly. No retry or authorization gate is disabled.
- The reference-table preview attempted to inspect fixture rows before its asynchronous build was ready. It now waits for the existing explicit build-ready status before inspecting rows and bounded reference requests. The original row and lookup assertions remain intact.

## Verification

- Strict types, boundary/copy checks and all four production builds passed after the overflow correction (`/tmp/gabs-resource-sort-build-final.log`).
- **216 unit/PostgreSQL tests across 45 files passed in 53.15 seconds** on a fresh migrated/seeded database, removed afterward (`/tmp/gabs-resource-sort-full.log`). This verified the sorting/runtime implementation before the final presentation-only corrections. Thirteen focused query/cursor tests also passed (`/tmp/gabs-resource-sort-unit3.log`). Shared development data was preserved.
- **Twelve distinct headless browser journeys passed across focused runs.** The initial two sorting journeys passed in 29.7 seconds and six range/list/table regressions in 59.7 seconds. After correcting the CI regressions, the final **nine-journey run passed in 1.9 minutes** (`/tmp/gabs-resource-sort-browser-final.log`), covering signed installation, authoritative sorting, cursor rejection, archived boundaries, offline page reuse, profile/resource reset, references, development permission changes and all three narrow local dialogs.
- **Two distinct hidden/unfocused native journeys passed in 18.9 seconds**: sorting and local-worker restart (`/tmp/gabs-resource-sort-native.log`). The final rebuilt sorting rerun passed in 14.8 seconds (`/tmp/gabs-resource-sort-native-final.log`). Tests assert hidden/minimized and unfocused state at both ends and preserve renderer isolation.
- The final standalone screenshot correction waits for the popup to become hidden and verifies the first UUID-ordered record after resetting. That headless journey passed in 7.6 seconds (`/tmp/gabs-resource-sort-local-capture2.log`). No foreground browser or desktop windows were opened.
- Scoped Axe found no violations in the generated corporate resource area. Existing 390-pixel overflow assertions passed. Nine captures were inspected: [wide](wide.png), [narrow controls](narrow.png), [narrow actions](narrow-actions.png), [local sorted page](local.png), [local reset](local-reset.png), [Electron](electron.png), [local action recovery](local-actions-narrow.png), [coordinated local installation](local-install-narrow.png), and [retained local versions](local-versions-narrow.png). Historical screenshots overwritten by regressions were restored.

The subsequent range checkpoint `39a9b37` / [CI 35180810161](https://github.com/mateoltd/gabs/actions/runs/35180810161) completed with 212 unit/database tests and 90 browser cases passing, and the same five browser cases failing. Load/restore were skipped; all three unsigned packaging commands passed, and uploads hit the same account quota. These fixes require their own remote run; no remote acceptance is claimed.

Final formatting passed, regenerated OpenAPI/client types had no drift, and all checked local documentation links resolved.

## Limits

Pages reflect current records and do not provide snapshot isolation; concurrent sort-field edits can move records across boundaries. Nested sort paths, locale-aware collation, aggregation, arbitrary schema composition and large-local-dataset performance acceptance remain open. Cross-module standalone capabilities and resource-client ergonomics remain tracked. Scoped Axe and hidden development Electron do not establish whole-product accessibility, signed release readiness or final UI approval. OPS-07 performance and the GitHub artifact quota remain separate open work.
