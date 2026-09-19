# Local verification

Recorded on 15 September 2026. Node 24.19.0, pnpm 12.4.1, macOS arm64 (Apple M3 Pro, 18 GiB), PostgreSQL 18.6 in Docker.

| Check                                                 | Result                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| Strict TypeScript and dependency boundaries           | Passed                                                              |
| Formatting and UI copy checks                         | Passed                                                              |
| Domain and real PostgreSQL tests                      | 24 passed                                                           |
| Chromium workflows                                    | 9 passed                                                            |
| Actual Electron sign-in/bridge/storage-fallback tests | 2 passed                                                            |
| Production web, API, worker and desktop bundles       | Built successfully                                                  |
| API, worker and web container images                  | Built successfully                                                  |
| API container database health check                   | Passed                                                              |
| macOS arm64 application, ZIP and DMG                  | Produced; packaged application launched and visually inspected      |
| Worker processing and aggregate health logs           | Observed locally                                                    |
| Logical database restore                              | Passed balance, reservation, movement reconciliation and RLS checks |

Browser coverage includes the full stock-to-fulfilled-order workflow, cold offline shell restart, explicit draft recovery/upload, logout cleanup, denied viewer actions, stale workspace response isolation and a simulated storage quota failure. The redesign adds workspace-wide summary and paginated-filter tests, module visibility checks, dashboard links, keyboard filters, protected-role presentation, dialog focus restoration, reduced motion, and a trapped mobile navigation drawer. Axe checks found no WCAG A/AA violations in the tested Orders, Overview (light/dark), and order-editor views. Light/dark and narrow views were visually reviewed. The narrow-layout test waits for actual data before checking page overflow.

The Electron test launches the real runtime with an isolated profile. It checks unavailable Node globals, a bounded renderer bridge, rejection of an unregistered operation, denied popup creation, and refusal to persist drafts when OS-backed storage is unavailable. The packaged application also opened its production sign-in screen; no live Auth0 tenant was configured for that package. The generated unsigned macOS artifacts are packaging evidence, not deployable production releases.

## UI redesign

The latest shared web/desktop interface uses Inter, IBM Plex Mono, and Hugeicons. It fills the viewport, with no mockup wallpaper, outer frame, or presentation padding. macOS uses native under-window vibrancy. The Orders view has a persistent detail panel, seven-day server metrics, order activity, and workspace search. The sign-in view uses the supplied orange halftone filter, including responsive dot pitch and high-density rendering.

The latest pass ran 24 domain/PostgreSQL checks, all 9 browser workflows, and both real Electron tests. The final sign-in handoff change also reran the 3 focused redesign browser tests. Axe found no WCAG A/AA violations in the tested sign-in, Orders, Overview, and editor states after search contrast corrections. Wide and narrow sign-in screenshots were inspected, along with the full-viewport workspace, searchable Inventory, and native Orders/detail layout. The local desktop was rebuilt, restarted, and signed into Northline Supply through its development login.

Managed-login UI tests intercept the provider handoff to verify email encoding, signup, and SSO navigation. They do not verify a live Auth0 tenant. Desktop tests still verify working development sign-in, an honest unconfigured state, and the renderer/storage boundaries. Web asset update prompting was exercised in the actual preview: a waiting update appeared, the reload button activated it, and the new UI loaded without changing browser cache settings.

Web, API, and desktop bundles were rebuilt for this pass. No new installer, signed release, container, load run, or restore exercise was produced by this redesign; those results in this document are the earlier implementation baseline. The mockup-staging rule was also recorded in the user's global AGENTS.md. See the [UI conventions](../ui.md).

## Desktop sign-in correction

The previous unsigned installer had no Auth0 configuration and could not sign in. The local desktop now reports its actual authentication mode through a constrained IPC operation and offers **Open local workspace**. Unconfigured builds explain the missing setup before an OAuth attempt. Development profiles are separate from packaged-app data, and development authentication still requires an unpackaged app, explicit opt-in, development mode and a loopback API.

Two real Electron tests passed: local Owner sign-in plus renderer/storage boundary checks, and the unconfigured screen with development authentication rejected in production mode. TypeScript, dependency/copy checks, web and desktop builds, and the browser Viewer sign-in/navigation test passed. Five negative packaging checks rejected missing or invalid API, issuer, client ID, audience and callback settings. The root `pnpm dev:desktop` launch was also signed into Northline Supply and verified on Orders. Hosted Auth0 authentication remains unconfigured and unverified.

## Performance

The [load report](load.json) records a dataset of 1,000 orders, one line per order, one stock item, 50 concurrent HTTP clients and 50 samples per operation. All clients use one authorized actor and contend for the same stock item. p95 was **135 ms** for order reads and **230 ms** for confirmation, against local targets of 500 ms and 1,000 ms. This is a loopback pilot benchmark, not a 50-distinct-user production capacity result.

The [restore report](restore.json) records a logical dump restored into an isolated local database. It found zero invalid balances, reservation discrepancies or ledger mismatches. Managed point-in-time recovery, backup retention and complete service restoration remain staging acceptance work.

## Remaining external acceptance

- Live Auth0 enrollment, MFA, web/native callback and refresh-token behavior.
- Signed/notarized artifacts and a real update between two releases while preserving drafts.
- Windows and Ubuntu 24.04 installed-runtime acceptance. Their CI packaging jobs are configured but have not run remotely here.
- Private hosted export storage, HTTPS routing, managed databases, monitoring destinations and backup policies.
- A full staging restore exercise against the stated RPO/RTO, and manual assistive-technology verification.

No production resources, user invitations, email messages, releases or git changes were published.

## Modular platform implementation, 15 September 2026

This is fresh verification of the SDK/hybrid platform expansion. It supersedes the earlier two-module scope descriptions above. The [requirement ledger](../requirement-ledger.md) records implementation gaps; this is not full release acceptance.

| Check                                                          | Result                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| TypeScript and dependency/UI-copy boundaries                   | Passed (`pnpm check`)                                                        |
| Unit and PostgreSQL integration tests                          | 41 passed across 6 files                                                     |
| Full Chromium user-journey suite                               | 41 passed                                                                    |
| Electron runtime and storage boundary tests                    | 2 passed                                                                     |
| Web, API, worker and desktop builds                            | 4 successful build tasks                                                     |
| Formatting                                                     | Passed                                                                       |
| Local logical backup and restore                               | Passed, zero balance/reservation/ledger discrepancies                        |
| High-contrast follow-up after final Settings layout adjustment | Passed; four principal text/surface pairs meet 7:1 across all ten archetypes |

The distribution test publishes a fifth signed declarative module under a temporary trust root, installs it, writes through its generated API and verifies uninstall preserves its business record. It does not change host source. Type checks include invalid-resource/enum/required-field cases. Business tests cover concurrent reservations and idempotent fulfillment through the typed SDK route, alongside the existing transactional tests.

Browser journeys cover Contacts/Projects, signature-backed install/repair/uninstall, encrypted local profiles, offline capture across reload and reconnect, resumed edits retaining their original record identity, and an accepted create whose response is lost and retried without duplication. The full existing Orders/Inventory, accessibility, keyboard, navigation, motion and update-prompt suite also passed. A final presentation adjustment moved the Settings heading before its sections and removed the duplicate theme toggle; its focused theme test passed afterward.

Electron tests use the real local Electron runtime, not a browser imitation. They verify renderer isolation, protected cache writes/reads/purge, refusal when OS protected storage is unavailable, and honest unconfigured authentication behavior. They do not establish signed/notarized installed acceptance on every target OS. The LAN test uses short-lived local certificates to exercise mutual TLS, port fallback and foreign-workspace rejection.

Inspected actual browser screenshots: [module installation](modular-platform/installation.png) and [high contrast](modular-platform/high-contrast.png). The contrast test covers specified token pairs; it is not a whole-product WCAG AAA claim. Live Auth0, Stripe delivery, signed production releases, Windows/Linux installed runtime and the remaining functional gaps have not been verified or completed.

Local migrations 007–011 and development-only signed releases were applied. No live payments, production deployment, external messages or Git publication were performed. Development signing keys remain in ignored `.local/module-keys`.

## SDK, lifecycle and business continuation, 16 September 2026

Completed and verified this continuation:

- Scoped server contexts, inferred configuration/events/business errors, typed public-service references, per-service administrator grants and current actor authorization. Cross-module records, audit, events and idempotency commit together. Rejected, caught-failure and detached-failure service calls roll back all writes. Custom event names cannot collide with host event types. Nested record/tuple validation survives signed JSON transport, and unsupported transported schema types fail closed.
- Discovery and exact contract matching for simultaneously staged backend releases. Inventory 1.1 remains staged alongside 1.2. Employee clients can read the version pins needed for installation without reading administrative configuration.
- An isolated loopback developer workspace with generated forms, fixture validation, source reload, connectivity/permission simulation and operation-journal inspection. A real browser captured an offline record, verified it remained provisional, synchronized it and verified the accepted record. This simulation is not a substitute for production-server integration tests.
- Background installation on authorization/catalog refresh, current-state approval/denial cards in the inbox, policy-aware notification routing, active workspace-member task assignment, structured contact addresses, cached reference labels and version-checked physical stock counts.

Validation:

| Check                                                | Result                                                |
| ---------------------------------------------------- | ----------------------------------------------------- |
| TypeScript, dependency boundaries and UI-copy checks | Passed                                                |
| Unit and PostgreSQL integration tests                | 59 passed across 8 files                              |
| Complete Chromium suite                              | 45 passed                                             |
| Real Electron runtime checks                         | 2 passed                                              |
| Web, API, worker and desktop build tasks             | Passed                                                |
| Formatting                                           | Passed                                                |
| Local logical backup/restore                         | Passed, zero balance/reservation/ledger discrepancies |

Browser testing caught and fixed fragment-wrapped select options being omitted. Installation acceptance now removes installed dependents before uninstalling Contacts, because background installation installs Projects too. Stock-count assertions distinguish the actual modal from nonmodal success notifications. Final follow-up checks cover destructured typed clients, employee pin visibility, signed-schema hydration and the local profile resource order. Screenshots were inspected: [stock count](modular-platform/stock-count.png), [developer simulator](modular-platform/developer-simulator.png).

Local migration 012 and signed development releases Contacts 1.1, Projects 1.1 and Inventory 1.2 were applied. A full disk interrupted development; only this project's reproducible desktop packaging output was removed, and the local database runtime was restarted. No business data or source files were deleted.

The full plan remains incomplete. In particular, the two existing trusted business adapters still have direct transaction access; independently executable packages, module migration orchestration, full identity/recovery, background push, integrity lockdown, additional LAN capabilities and production/provider acceptance remain open in the requirement ledger. No production deployment, live payments or external messages were performed.

## UI reconciliation, 16 September 2026

The [reconciliation report and screenshot gallery](ui-reconciliation/README.md) record the reconstructed visual baseline, corrections, recovery archives and limitations. Verification includes 59 unit/integration tests, 50 Chromium tests, 20 overlapping focused follow-ups, three actual Electron tests, builds and formatting. The visual review covers 66 screen/theme/viewport combinations plus all ten archetype controls, dialogs, menus, local profiles and native desktop views. New regression checks preserve default geometry, original navigation order, workspace-scoped preferences, readable narrow layouts, keyboard controls and native local-profile surfaces.

A later wide-layout follow-up removed the Overview page's 1200px content cap. The focused Chromium overview test passes at a 1800px viewport and asserts that the page matches the route width; direct browser inspection measured both at 1660px. The web production build and formatting check also pass.

This completes the UI reconciliation work, not functionality parity. Feature expansion remains paused at the user's request. Exact historical pixel recovery, universal accessibility and production desktop release acceptance are not claimed.

## UI-R02 shared-list redesign, 16 September 2026

[Scoped evidence and screenshots](people-inventory/README.md) record the People, Inventory and Audit redesign and common base used by every native table renderer. Fifteen distinct Chromium checks passed across the final regression run and focused reruns; six motion checks and one actual Electron list check also passed. Web/desktop production builds, TypeScript, boundary/copy checks and focused formatting passed. The screenshot review covered dark/light web views, 768px/390px bounded layouts and all four principal lists in native Electron.

The regression run exposed an assertion racing navigation and an old expectation that zero-stock rows say “Low stock.” Both tests were updated to the intended observable behavior and passed on rerun. Native and browser images were inspected; the review corrected Audit status-color specificity. Member-save testing intercepted the request, and no real invitation or access change was submitted. Existing business acceptance tests created local demonstration orders/products and verified actual stock effects. Feature parity and production desktop release acceptance remain open.

## Independently signed executable client modules, 16 September 2026

EXT-01 passed local acceptance: a fifth typed TSX module built/published outside host discovery installs dynamically, saves and reloads real records, contains its styles, and rejects corrupt executable downloads. Final checks passed: 62 unit/integration tests, 55 Chromium journeys, 5 actual Electron tests, all builds, formatting and boundary checks. [Detailed evidence and explicit limits](executable-modules/README.md). Framework, lifecycle and release gates remain open.

### Registry publication authority, 16 September 2026

Migration 013 revokes registry writes from ordinary application/worker roles. The existing real PostgreSQL distribution test now verifies SQL permission denial before privileged fixture publication and normal API installation. Migration, seed, strict types/boundaries and all 62 tests passed after the change. No UI code changed in this follow-up; the preceding browser/native evidence remains scoped to EXT-01. Reviewed staging/promotion remains open under EXT-02.

## Reviewed independent server releases, 16 September 2026

EXT-02 now has an official CLI submission/review/stage/publish workflow and independently signed server loading. PostgreSQL acceptance verifies immutable review, restricted publication, failed staging, retry deduplication, atomic rejection, current permissions and pinned executable versions. The fifth module exercises client and server publication through the CLI and actual web/native UIs against the compiled API.

Final local verification: 63 unit/integration tests, 55 Chromium journeys, 5 Electron journeys, all builds and formatting; fresh migrations/seed and local logical restore passed. Local p95 reads/confirmation: 212/258 ms against unchanged 500/1000 ms targets. The preceding remote commit failed the read latency target despite passing its browser and all unsigned packaging jobs. [Detailed evidence and remaining limits](module-server-releases/README.md).

## 16 September 2026: administrator activation of new modules

The existing-company activation journey now verifies configuration, entitlement rejection, employee visibility, dynamic permissions, member assignment and independently deployed server behavior. Full local acceptance passed 63 unit/PostgreSQL tests, 56 Chromium journeys, 5 Electron journeys, all builds and formatting. [Scope, screenshots and limits](module-activation/README.md). EXT-02 and the overall parity goal remain active; the publisher review interface, migration recovery and other release gates are still open.

## 16 September 2026: registry resolution query scope

Release resolution now fetches selected executable packages after resolving metadata. Local load, integrity and authorization regression evidence is recorded in [registry resolution](registry-resolution/README.md). Remote CI performance remains unverified; targets were not relaxed.

## 16 September 2026: official release review console

The protected operator console completes EXT-02's local submission/review/stage/publish interface. The actual CLI, restricted-role HTTP checks, an approval/publication and rejection browser journey, accessibility and narrow layout were verified; all 64 unit/PostgreSQL tests passed. [Evidence, screenshots and limits](registry-console/README.md). EXT-03 is active next; hosted release gates and remote latency remain open.

## 16 September 2026: scoped module storage migrations

EXT-03 is verified locally: signed schema declarations, typed scoped handlers, atomic failure/crash recovery, concurrent retries, reference validation, compatible pins and administrator migration/retry controls. Final checks passed 66 unit/PostgreSQL tests, 58 Chromium journeys, 5 Electron journeys, all builds, formatting and local restore including module schema history and tenant isolation. Local p95 reads/confirmation: 150/233 ms. [Detailed evidence, screenshots and limitations](module-migrations/README.md). EXT-04 is active next. Remote CI at `e5be7b0` failed its unchanged read-latency target at 925 ms; that gate remains open.

## 16 September 2026: durable installation and update recovery

EXT-04 is verified locally. Exact signed release selections, durable request identities and server receipts recover interrupted downloads, lost replies, local write failures and complete Electron restarts without duplicate effects. Incompatible pins and stale receipts are rejected; uninstall preserves business records and pending work. A real growing-catalog failure led to content-addressed executable storage with bounded IPC writes, atomic metadata commits, legacy migration and orphan cleanup. Recovery controls preserve current host components.

All 68 unit/PostgreSQL tests, 59 Chromium journeys, 6 Electron journeys, builds, formatting and local logical restore passed. Local p95 reads/confirmation were 162/183 ms. An intermediate browser failure came from concurrent test suites sharing temporary registry fixtures; the final run used isolated sequential verification without weakening assertions. [Evidence, screenshots and limitations](module-recovery/README.md). OPS-07 is active next for the remote read-latency failure at `101ff85` (952 ms against 500 ms), followed by EXT-05 rollout controls. Full parity and overall UI acceptance remain open.

## 16 September 2026: order-list latency correction awaiting remote acceptance

A fresh-workspace query plan exposed 499,500 customer/order join comparisons before pagination. The list now uses tenant-scoped indexed customer lookups, while search and cursor filters retain their semantics. Local plans fell from 21.422 ms to 0.122 ms. The unchanged uninstrumented load fixture passed at p95 104/172 ms for reads/confirmation; all 69 unit/PostgreSQL tests, 17 selected browser journeys, builds and formatting passed. [Plans, profiling limits and evidence](performance/README.md). OPS-07 stays in verification until the candidate passes the unchanged remote CI budgets and restore gate.

## 16 September 2026: module release identity and remote load diagnostics

Typed clients, generated screens and offline journals carry their authoring release through browser/native transports. The API rejects mismatches before writes and receipt replay; legacy retries retain their original hash. Verified 72 unit/PostgreSQL tests, 14 focused Chromium journeys, all six distinct Electron journeys and four builds. [Scope and limitations](client-module-version/README.md). EXT-05 remains active for accepted-version policies, rollout controls and observability.

Remote run `35056056304` still failed reads at 670 ms while confirmation passed at 726 ms. CI now captures CPU/query diagnostics after a failed gate and independently runs restore. Targets are unchanged; [OPS-07 remains open](performance/README.md).

## 16 September 2026: authorization round-trip reduction

Remote results varied: `6442851` passed at 387/420 ms, while `1b7d216` failed read p95 at 552 ms; its confirmation was 593 ms and restore passed. Captured diagnostics show 750 queries across 50 reads. The candidate reads current user, membership, policy and complete role/assignment graph in one statement, reducing the fixture to 650 queries without caching authorization. All 74 unit/PostgreSQL tests, 18 distinct selected browser journeys, four builds and formatting passed locally; uninstrumented load was 102/177 ms. [Reports, regression scope and limits](performance/authorization/README.md). OPS-07 remains open pending the exact remote candidate result.

## 16 September 2026: stock receipt replay authorization

The receiving/adjustment route now derives its current permission before idempotent replay. All 75 unit/PostgreSQL tests passed, including revocation, independent remaining access, restoration and exactly four expected stock movements. The rebuilt API passed real stock/order fulfillment and viewer accessibility/theme/narrow-layout browser flows. [Detailed limits and evidence](client-module-version/README.md). The prior authorization performance candidate is under remote verification; full parity remains open.

## 16 September 2026: explicit optional and mandatory client releases

EXT-05 now has explicit accepted-release policies, exact mixed-version dispatch, mandatory-update controls in the existing configuration dialog and compatibility checks across migrations, configuration and selected providers. Browser installations retain accepted older contracts; rejected queued work survives an upgrade and can be explicitly reviewed into a new request. Generated views and caches follow the installed contract, reference pickers identify their provider release, and committed installation receipts refresh administration immediately.

All 76 unit/PostgreSQL tests, 16 focused Chromium journeys, six Electron regression journeys, four builds and formatting passed. Policy controls passed Axe checks and wide/narrow visual inspection. [Evidence and specific limits](module-rollout/README.md). EXT-05 remains active for native mixed-version acceptance, safe unsaved-editor handoff, lost-success-reply recovery across updates, fleet progress, failure reporting and connected suspension delivery. OPS-07 remains open: the latest remote read p95 was 689 ms against the unchanged 500 ms target. Full parity and final UI approval have not been achieved.

## 16 September 2026: lost-success-reply recovery across module updates

An exact authorized retry now recovers its committed result after a mandatory update, without re-executing the old handler or rewriting the original request identity. New work still requires the current rollout policy. Current declared permissions and suspension apply before receipt recovery; modified request bodies/releases are rejected. The browser proof drops a real successful HTTP reply, disconnects, changes policy and reconnects, then verifies one record, one audit entry and one receipt. The Electron bridge verifies the same recovery boundary.

All 76 unit/PostgreSQL tests, 19 distinct focused browser journeys, six Electron journeys, four builds and formatting passed. [Evidence, fixture correction and remaining limits](receipt-recovery/README.md). EXT-05 and OFF-03 remain open for the broader recovery/update workflows. Remote CI for the preceding milestone passed 60 browser journeys and restore but failed read latency at 637 ms; OPS-07 remains open.

## 16 September 2026: live-editor preservation during module updates

Generated editors now survive schema updates, failed downloads and removal of their resource, retaining original identity and explicit recovery input. Exact uncertain attempts recover their earlier receipt even if the new schema adds required fields. Custom components stay mounted until explicit replacement; typed state transfer remains open. Recovery exports distinguish unsaved work from unconfirmed server effects, and the actual Electron IPC validates the document and writes the user-selected file.

All 76 unit/PostgreSQL tests, 27 distinct selected Chromium journeys, six Electron journeys, all builds and formatting passed. The three new browser journeys and six Electron checks were rerun after the export implementation; the recovery dialogs were visually inspected at wide/narrow sizes. [Exact evidence, test scope and remaining limits](editor-updates/README.md). Remote `35092809379` had 60/61 browser passes and skipped load/restore after a filter-test race, now corrected. The last remote read p95 remains 637 ms. EXT-05 and OPS-07 remain open, as does the broader parity goal.

## 16 September 2026: native journal restart through mandatory updates

Two new real Electron journeys passed, bringing distinct local native coverage to eight. They capture old-release work offline, interrupt its native transport, change the server's release policy and reopen the same protected profile in a fresh process. Unaccepted work remains recoverable for explicit review; an accepted request with a lost reply recovers its exact original receipt. Both leave one record, one create audit and one receipt. The actual conflict and recovered-record screens were inspected. [Procedure and limits](native-rollout/README.md). This test-only milestone does not establish abrupt-crash, profile-revocation or cross-platform installed acceptance. EXT-05 remains active.

## 16 September 2026: typed custom-view state transfer

Manifest-declared state now gives custom views inferred read-only input, validated saves and explicit conversion across releases. Real independently signed modules preserve live input, block replacement during writes, reject invalid conversion and recover the previous view after initial rendering fails. A broader regression also found and fixed stale background installation undoing a completed uninstall.

All 79 unit/PostgreSQL tests, four production builds and formatting passed. The broad browser selection passed 26/27, exposing the uninstall race; all seven affected journeys passed after its fix, yielding 27 distinct selected browser passes across iterations. All nine native journeys passed after that fix, minimized and unfocused. Both failure messages, wide/narrow fields and native restored input were visually inspected. [Exact evidence, authoring guide and limits](custom-view-state/README.md). This does not establish durable custom-operation recovery, a complete local browser run or cross-OS signed installation acceptance. EXT-05 and the overall parity goal remain active.

## 16 September 2026: generated editor recovery in Electron

Two new minimized native journeys passed, verifying open forms through failed artifact downloads, mandatory schema changes, native recovery exports and removed resources. An uncertain save recovers the exact accepted request after the update with one audit and receipt. The two matching browser journeys passed with the extracted shared fixture; TypeScript, boundary/copy and formatting checks passed. [Evidence, inspected screens and limits](native-editor-updates/README.md). This is test-only acceptance on the preceding implementation and brings distinct native coverage to eleven across milestone runs. EXT-05 remains active for fleet progress/failures and connected suspension.

## 16 September 2026: device rollout reporting

Module administration now distinguishes server installation receipts from bounded client progress/failure observations and shows a paginated device view. Reports retain their sequence and pending delivery in scoped storage; ready reports require the current receipt. Dependency reuse preserves receipt timestamps. Broad verification also corrected automatic assignment of dynamically discovered modules to new workspaces and an interaction lock that outlived a completed member save.

All 81 unit/PostgreSQL tests and four production builds passed. The full browser selection passed 63/66 before corrections; all 11 affected browser journeys passed afterward, including the three failures. All 11 minimized Electron journeys and formatting passed. Wide/narrow failure and recovery screens plus the native device view were inspected; the browser dialog passed Axe A/AA checks. [Evidence and remaining acceptance](module-fleet/README.md). EXT-05 remains active for report delivery/preflight/removal coverage and connected suspension/emergency offline acceptance. Parity and final UI refinement remain unfinished.

## Durable lifecycle report recovery

[Report recovery evidence](report-recovery/README.md) records bounded delivery and persistent retries, preflight observations, receipt-validated removal progress, account binding and terminal rejection. All 85 unit/PostgreSQL tests passed, with the affected lifecycle test repeated after the final refinement; six selected headless browser journeys and all 11 minimized Electron journeys passed. Builds and formatting passed, and wide/narrow/native device views were inspected. Connected suspension and emergency/offline acceptance remain open.

## 16 September 2026: connected suspension and lease recovery

[Connected suspension evidence](module-suspension/README.md) records transactional policy delivery, fresh authorization, monotonic revisions, existing-workspace backfill, hidden editor/portal preservation and offline lease expiry without pending-work loss. Reauthorization is required before synchronization resumes.

All 88 unit/PostgreSQL tests, strict types/boundaries/copy checks and four builds passed. The broad browser run passed 66/67; after fixing a restoration race, the strengthened delayed-reply journey passed three consecutive runs and all eight affected lifecycle journeys passed. Thus 67 distinct browser journeys passed across iterations, not a fresh all-67 run after the final fix. After the final cache-ordering refinement, three focused policy tests and six affected browser journeys passed. All 12 minimized/unfocused Electron journeys passed on the final application build. Wide/narrow/native screens and corrected Orders layout were inspected. EXT-05 has local acceptance; SDK-01 is next. Overall parity and the later UI-refinement goal remain unfinished.

## 16 September 2026: private transactional module stores

The [private-store foundation](private-stores/README.md) adds schema-inferred server-only records with row locking, versioned writes, uniqueness, bounded pagination and data-preserving archival. Granted services propagate the same transaction; caught/detached errors roll back stores, audits and events. Reviewed migrations convert private records and reject incompatible schemas or duplicate unique values.

All 93 unit/PostgreSQL tests, strict types/boundaries/copy checks and four builds passed. Both selected headless browser journeys and all three selected minimized/unfocused Electron journeys passed. This is SDK-01 foundation acceptance; Orders/Inventory handlers and existing-data/read-model migration still require implementation. No UI styling was changed, and full product/production acceptance remains open.

## Inventory SDK candidate, 16 September 2026

The [Inventory 2.0 scoped candidate](inventory-sdk/README.md) passes signed API/PostgreSQL acceptance for reservations, stock changes, counts, permissions, retry, atomic rollback and prepared-snapshot migration. All 104 unit/PostgreSQL tests, strict types/boundaries/copy checks and four builds passed; eight selected browser journeys and three minimized/unfocused Electron journeys passed. The default business releases and UI are unchanged. SDK-01 remains active for actual Orders handlers, reusable read models, relational conversion/reconciliation and coordinated rollout. This is not a complete business or framework acceptance gate.

## Orders SDK candidate, 16 September 2026

The [Orders candidate and typed service contracts](orders-sdk/README.md) add private numbering/order stores, authoritative totals/snapshots, Inventory transactions, typed error translation and prepared-import validation. All 112 unit/PostgreSQL tests and four builds passed; the CLI checked/exported provider contracts and built the independent Orders package. All eight selected headless browser and three minimized Electron journeys passed. The default business releases remain unchanged; SDK-01 stays active for read models, relational conversion, client adapters and coordinated rollout.

## Scoped queries and business summaries, 16 September 2026

[Scoped query acceptance](store-queries/README.md) adds typed filters/search/ranges/sorts, bounded encrypted pagination and complete aggregates. Both candidate business modules use these capabilities for read models and exports. All 118 unit/PostgreSQL tests and four builds passed; 25 affected tests passed after the locale-search refinement, then eight store tests passed with accented-text coverage. Three selected headless browser and three hidden Electron journeys passed. SDK-01 remains active for read-only dispatch, authoritative migration and application/worker integration; default releases and UI remain unchanged.

## Read-only operation dispatch, 16 September 2026

[Read-only query acceptance](read-only-operations/README.md) separates authoritative reads from command receipts and audits, enforces typed/host read boundaries and provides consistent per-request PostgreSQL snapshots. All 123 unit/PostgreSQL tests in 24 files, strict types/boundaries/copy checks and four builds passed. Five query tests passed again after additional authorization assertions. Four selected headless browser and all three selected hidden Electron journeys passed, including a signed custom module using the actual query transport, its administration flow and open-editor preservation during updates. Wide/narrow/native views were inspected. SDK-01 remains active for legacy migration, application/worker integration and complete snapshot exports; full parity and later UI refinement remain open.

## Coordinated legacy business conversion, 16 September 2026

[Legacy conversion acceptance](legacy-business-migration/README.md) reconciles authoritative relational data and imports both business modules through signed SDK migrations in one transaction. Source history and accepted receipts remain available; retired SQL writes are fenced, including waiting writers at cutover. All 129 unit/PostgreSQL tests, strict types/boundaries/copy checks and four builds passed. Two headless browser and three hidden Electron journeys passed. A five-second local logical restore verified migrated stock/ledger/reservations, order states/totals, numbering, RLS and the restored fence. Current application/worker adapters and administrator cutover/readiness remain unfinished; SDK-01 and full parity remain active.

## 16 September 2026: SDK-01 business exports and worker delivery

[Snapshot export evidence](business-exports/README.md): 130 tests, four builds, final 42 affected tests, one headless browser creation/download journey and a six-second logical restore. SDK exports include all pages from one authorized snapshot; concurrent edits, formula escaping, retries, scoped notifications, revoked access and worker RLS/write denial are exercised. Business-screen adapters and administrator cutover remain open; no UI acceptance or overall parity claim.

## 16 September 2026: SDK-01 selected-contract business screens

[Business-screen evidence](business-screens/README.md): selected SDK reads and version-bound commands preserve current UI behavior after migration. Covered migrated stock, counts, product edits, fulfillment, conflict review, offline reload and exact-key/version recovery after a lost accepted response. 130 tests, four builds, three browser journeys and three hidden Electron checks passed, with a further expanded migrated journey and inspected wide/narrow/native captures. Administrator cutover and default scoped releases remain open.

## Administrator business cutover, 16 September 2026

[Coordinated upgrade evidence](business-cutover/README.md) records read-only release/permission review, explicit service grants, stale-policy rejection, atomic grant/data migration and retry/completion recovery. All 134 unit/PostgreSQL tests in 24 files and four builds passed. The real administrator flow and subsequent scoped business work passed headless Chromium and hidden/minimized Electron. Wide, narrow and native dialog captures were inspected. Default scoped releases remain the next SDK-01 work; parity and accepted UI polish remain unachieved.

The preceding remote checkpoint `35128117193` / `9ea4364` passed functional/browser/build, unsigned packaging and restore but failed the unchanged read budget at 725 ms (500 ms target); confirmation passed at 747 ms (1000 ms target). OPS-07 remains open.

## Scoped business defaults, 16 September 2026

[SDK-01 default release acceptance](business-defaults/README.md) covers fresh personal/company namespaces, reviewed service grants, Sales permissions, legacy write rejection, exact retries, current SDK development/load fixtures and initialization-aware restore. Current source passed 135 tests in 25 files, strict checks, four builds, both minimized/unfocused native journeys and clean-database Chromium acceptance: 68 initial passes plus two focused passes after replacing legacy seed-number selectors, covering all 70 distinct cases. Scoped local load passed at 394/863 ms against unchanged 500/1,000 ms budgets; the earlier 1,067 ms confirmation failure remains recorded. Historical schema-1 conversion and receipt recovery remain supported. Remote performance, full release gates and UI refinement remain open.

## Local workers, 16 September 2026

The [SDK-02 worker foundation](local-worker/README.md) passes 138 unit/PostgreSQL tests, typed local/server capability separation, worker CPU cancellation/restart, atomic local receipts, real browser IndexedDB revision/deletion checks and hidden Electron restart. Existing standalone resource saves use workers without layout changes. Independent local executable distribution and installed custom-operation/upgrade journeys remain open.

The preceding scoped-default commit `c4460ce` / [CI 35134819192](https://github.com/mateoltd/gabs/actions/runs/35134819192) passed code/build, three unsigned packaging jobs and 69 browser cases. Screenshot cleanup in the remaining case timed out on a shifting notification index; it now waits for expiry instead. That run skipped load and restore, leaving remote acceptance open.

## Independent local executables, 16 September 2026

[SDK-02 signed local package acceptance](local-executables/README.md) covers independent CLI build/review/publication, authenticated device installation without a server component, worker signature/contract verification and encrypted profile installation/upgrades/receipt recovery. Current source passes 140 unit/PostgreSQL tests, strict checks, four builds, three focused headless browser cases and two minimized native cases. Electron uses the actual packaged worker under its real CSP and recovers an exact receipt after restart. End-user local installation/custom-operation flows and local schema migrations remain open.

Prior CI `35136781563` / `3d42f93` passed code/build, three unsigned packaging jobs and 70/71 browser cases; its upgrade retry selector raced live completion. The focused correction deterministically exercises exact request replay. Load/restore were skipped in that run; OPS-07 stays open.

## Local module controls and durable recovery, 16 September 2026

[SDK-02 interface acceptance](local-controls/README.md) verifies authorized personal-registry installation, local configuration, schema-derived operation inputs, cancellation/retry, rejected work, encrypted restart recovery and retained records after uninstall/reinstall. Current source passes 141 unit/PostgreSQL tests, strict checks, four builds, four focused headless browser cases and three minimized native cases. Wide/narrow/native captures were inspected; scoped Axe checks pass. Local schema migration, coordinated dependency changes and profile fleet reporting remain open.

Prior CI `35139112513` / `78206ad` passed code/build, three unsigned packaging jobs and 71/72 browser cases. The device-fleet case queried a downloading observation before failure acknowledgement; its corrected test waits for acknowledged reports and passes locally. Load/restore were skipped; remote performance acceptance remains open.

## Local schema migrations and offline restoration, 16 September 2026

[SDK-02 migration acceptance](local-migrations/README.md) covers separately versioned personal schemas, typed signed migration handlers, atomic installation/data changes, failure/cancellation/concurrent-session recovery, schema-compatible executable rollback and historical receipts after native restart. Offline restoration uses retained signed code and configuration. Current source passes 147 unit/PostgreSQL tests, strict checks and four builds, with four focused headless browser and three minimized native cases plus final migration reruns. Wide/narrow restoration captures were inspected. Durable installation attempts, coordinated dependencies and profile lifecycle reporting remain open.

Prior `294c5c8` / [CI 35141217552](https://github.com/mateoltd/gabs/actions/runs/35141217552) passed all 73 browser cases, code/build checks, three unsigned packaging jobs and a two-second logical restore. Load failed at 1,619/2,435 ms against the unchanged 500/1,000 ms budgets; the diagnostic repeat failed at 1,548/2,588 ms. OPS-07 and overall release acceptance remain open.

## Durable local installation recovery, 16 September 2026

[SDK-02 installation recovery](local-install-recovery/README.md) saves verified code/configuration before migration and resumes offline after browser navigation or native termination. Acceptance, selected release, records and migration history commit together. Explicit discard preserves installed data; replaying an accepted attempt cannot revert to older code. Four focused headless browser cases and three minimized/unfocused native cases passed, with additional focused checks for the corrected narrow layout and actual native recovery interface. Strict checks, 147 unit/PostgreSQL tests and four builds passed. Wide/narrow/native captures were inspected; scoped Axe checks pass. Coordinated dependencies and local-profile lifecycle reporting remain open.

## Coordinated local dependencies, 16 September 2026

[SDK-02 dependency-set acceptance](local-dependencies/README.md) covers complete active-set resolution, compatible consumer updates, separate local configuration, atomic multi-module migrations and encrypted offline set recovery. The interface restores retained dependencies together; current entitlement checks apply to each download. Current source passes 150 unit/PostgreSQL tests, strict checks, four builds, six distinct focused headless browser cases and three minimized/unfocused native cases. Wide/narrow/native captures were inspected. Download recovery before staging, profile fleet reporting and a general retained-release selector remain open.

Remote `0112be1` / [CI 35143593433](https://github.com/mateoltd/gabs/actions/runs/35143593433) passed all 74 browser cases, code/build, three unsigned packaging jobs and a two-second logical restore. Load failed at 1,490/2,609 ms against unchanged 500/1,000 ms budgets. The subsequent `ffd7773` / [CI 35145085258](https://github.com/mateoltd/gabs/actions/runs/35145085258) passed the same functional, packaging and restore gates, but failed load at 1,529/2,597 ms. OPS-07 remains open.

## Verified package reuse and scoped runtime performance

Bounded exact-content/signing-key caches and read-only snapshot release selection reduce repeated registry work while retaining current database authority checks. All 153 tests, four builds, four headless business journeys and local logical restore passed; local uninstrumented p95 was 170/596 ms versus 410/900 ms before changes. A separate diagnostic records 800 queries across 50 reads versus the prior 1,100. [Evidence and limitations](performance/verified-content/README.md). OPS-07 remains open pending exact candidate remote acceptance; full parity and final UI refinement remain outstanding.

## Durable local module downloads

Verified packages now persist before full installation staging, with account/workspace-bound missing-package recovery and offline configuration review. All 153 unit/PostgreSQL tests, four builds, eight headless browser cases and three distinct minimized native cases passed. A visual scroll issue was corrected and rechecked at wide/narrow/native sizes. [Evidence, screenshots and remaining scope](local-downloads/README.md). SDK-02, OPS-07 and full parity remain active.

## Retained local versions and lifecycle history

Schema-aware planning, offline retained-release selection and atomic local history passed 155 unit/PostgreSQL tests, four builds, nine distinct headless browser journeys and three minimized native cases. Wide/narrow/native layouts were inspected after replacing cramped columns with existing stacked lists. [Evidence and the SDK-02 acceptance map](local-versions/README.md) close SDK-02 locally; SDK-03 is next, and all broader SDK/identity/synchronization/application/release gates remain open.

## Module-owned development scenarios

[SDK-03 scenario acceptance](module-scenarios/README.md) verifies actual module-owned CLI execution, isolated fixtures, named failures, inferred authoring types and independent-directory dependency checks. Eight focused tests, strict types/boundaries/copy rules, Contacts CLI scenarios and a real temporary scaffold/test/cleanup cycle passed. No application UI changed; browser/native suites were not repeated. Custom React preview and cross-module fixtures remain active SDK-03 work.

## Custom React development preview

[SDK-03 preview acceptance](module-preview/README.md) covers an independent module's real public React/SDK/UI execution, permission/offline controls, typed rejection, editable state and recovery from source/render failures. Two headless journeys passed after final labeling/spacing fixes; wide/narrow captures and scoped accessibility were inspected. Strict checks passed. This is automatic simulation-resetting reload, not state-preserving Fast Refresh. Cross-module fixtures and missing private-store/audit simulator capabilities remain active work.

Remote `17673e8` / [CI 35152829899](https://github.com/mateoltd/gabs/actions/runs/35152829899) passed 160 unit/PostgreSQL tests, 79 browser cases, code/build, three unsigned desktop packages and a six-second logical restore. Load still failed at 558/1,584 ms against unchanged 500/1,000 ms targets. OPS-07 and full release acceptance remain open.

## Cross-module development fixtures, 17 September 2026

[SDK-03 provider acceptance](module-services-preview/README.md) verifies typed private/resource fixtures, explicit service grants, shared scoped transactions and development audits, independent CLI/provider scenarios, and React provider controls/reload. 54 focused unit/PostgreSQL tests and strict checks passed, followed by three headless browser journeys and a final provider-layout/Axe rerun. Wide/narrow captures were inspected. SDK-03 is locally verified against its development-workflow criteria; real SQL authority/durability, SDK-04/05 and complete release parity retain their separate gates.

Prior `a7a346c` / [CI 35154833179](https://github.com/mateoltd/gabs/actions/runs/35154833179) passed code/build and all three unsigned packaging jobs. Browser acceptance failed in device-fleet reporting (80 passed, one failed), with a downloading observation after the acknowledged failure. Load/restore did not run. This is an outstanding regression to investigate, not successful remote acceptance.

## Background lifecycle retry correction, 17 September 2026

[Durable retry evidence](report-recovery/README.md#17-september-2026-bounded-background-lifecycle-retries) explains the prior CI fleet failure and verifies persistent background retry delays, immediate explicit recovery and unchanged request identity. The PostgreSQL lifecycle integration, strict checks, four builds, two headless browser journeys and one minimized/unfocused native restart case pass. Fresh remote CI remains pending; OPS-07 and full parity remain open.

## Typed structured schema forms, 17 September 2026

[SDK-04 form evidence](schema-forms/README.md) records public inferred draft/validation contracts, recursive form controls, invalid-input preservation, contained custom-view dropdowns, and exact nested data accepted through Electron into PostgreSQL. 25 focused tests, strict checks/four builds, 21 distinct headless journeys across correction runs and four minimized native cases passed. Wide/narrow/native captures and scoped Axe checks were reviewed. Lifecycle setup and staged-update waits were corrected after tracing failures; load budgets and business assertions were not changed. SDK-04 remains active for generated documentation, tables/filtering/pagination, references and further composability. Full remote acceptance, parity and final UI approval remain open.

## Schema-derived module references, 17 September 2026

[SDK-04 documentation evidence](module-documentation/README.md) covers complete contract references, CLI/build output parity, drift detection and metadata escaping. 20 focused tests, strict checks and four builds passed; final documentation checks passed after section-navigation and escaping review. Generated examples for all four applications and an independent service consumer compile against their real definitions. No application UI changed. SDK-04 remains active for generated tables/filtering/pagination, references and wider composability.

## Typed resource lists, 17 September 2026

[SDK-04 resource-list evidence](resource-lists/README.md) covers inferred filters, reusable table/filter components, bounded paging, structured values and normalized durable query caches. Strict checks/four builds, 50 focused tests, 18 distinct headless journeys across correction runs and a final minimized native journey passed. Real offline checks caught and corrected stale cached-page state. Scoped Axe and 390-pixel overflow checks passed; wide/narrow/native artifacts were inspected. Activation/fleet test corrections passed locally after inspecting the two failed remote runs; fresh full remote/load/restore acceptance remains pending. SDK-04, wider parity and final UI approval remain open.

## Recursive resource references, 17 September 2026

[SDK-04 reference evidence](reference-fields/README.md) covers recursive corporate CRUD validation, bounded authorized lookup, typed bridge queries, public bundle exports and searchable generated form/filter pickers. All 189 unit/PostgreSQL tests, strict checks/four builds, 14 distinct headless journeys across correction runs and two hidden/unfocused native journeys passed. A final browser pass verifies actual nested-reference filtering, retry, offline retention and rejection-driven label eviction. Scoped Axe/overflow checks passed and four visual artifacts were inspected. One earlier concurrent-draft request failure did not recur in diagnostic reruns; its cause remains unresolved under OPS-07. This milestone does not complete SDK-04, general offline working sets, independent/standalone reference adapters or overall parity.

Prior `f701463` / [CI 35165655671](https://github.com/mateoltd/gabs/actions/runs/35165655671) passed 180 unit and 84 browser cases, three unsigned desktop packages and a two-second logical restore. Activation/fleet corrections are confirmed remotely. Load remained above unchanged 500/1,000 ms budgets at 854/1,788 ms. Fresh remote acceptance for the reference checkpoint remains pending.

## Recursive migration references, 17 September 2026

[SDK-04 migration reconciliation evidence](migration-references/README.md) extends recursive public-resource reference checks to final migration state. Signed fixtures reject new nested/member/cross-module links, changed schema semantics, intermediate-write bypasses and newly archived targets while preserving valid historical links and transaction rollback. The final production change passed all 189 unit/PostgreSQL tests; expanded targeted cases and initialized-storage coverage passed afterward. All four builds and strict checks passed. The headless administrator journey verifies rejection, retained data, successful retry and incompatible-pin rejection, with scoped Axe and five inspected captures. No UI source was changed; native/hosted release and overall parity acceptance remain open.

## Public SDK reference clients, 17 September 2026

[SDK-04 reference-client acceptance](reference-client/README.md) covers schema-validated lookup and form loaders in independent installed React views, scoped server queries, standalone generated forms and the CLI development preview. The full suite passed 194 tests; a final cancellation change passed 11 focused tests. Strict checks/four builds, five distinct headless journeys and two hidden/unfocused Electron journeys passed. Scoped Axe and four fresh captures were inspected. SDK-04, local/simulator write-reference integrity, broader host capabilities and full parity remain open.

Prior checkpoint `7401f8d` / [CI 35170982721](https://github.com/mateoltd/gabs/actions/runs/35170982721) passed 189 unit/PostgreSQL tests, all 85 browser journeys, code/build, all three unsigned packaging jobs and a two-second logical restore. Load acceptance failed unchanged read/confirmation targets at 891/1,821 ms; the diagnostic run measured 861/1,841 ms. These results verify the preceding migration checkpoint, not the subsequent reference-client changes. OPS-07 remains open.

## Local and simulated reference integrity, 17 September 2026

[SDK-04 write-reference acceptance](reference-integrity/README.md) closes ordinary local/simulator create/update validation: nested active links, current grants/memberships, failed-edit preservation, caught-error rollback, exact retries and provisional offline rejection. All 201 unit/PostgreSQL tests, strict checks/four builds, three headless journeys and one minimized/unfocused Electron profile-recovery journey passed. The new write-denial capture was inspected and historical captures were preserved. Standalone migration reconciliation, broader SDK composition and platform parity remain open.

## Standalone migration reference reconciliation, 17 September 2026

[SDK-04 local migration acceptance](local-migration-references/README.md) covers final nested-reference checks, verified original source contracts, historical archived links, copied/new annotations, forward-created targets and failure recovery. All 206 unit/PostgreSQL tests, strict checks/four builds, two distinct headless journeys plus a final capture rerun, and one minimized/unfocused native package recovery journey passed. A real signed browser installation rejects a tampered source package and an invalid migration before accepting a corrected release with unchanged receipts. Two new captures were inspected; historical captures were restored. Broader SDK composition, cross-module local capabilities and full platform parity remain open.

Prior `ce0b275` / [CI 35173409882](https://github.com/mateoltd/gabs/actions/runs/35173409882) completed: 194 unit/PostgreSQL tests, all 87 browser journeys, code/build, three unsigned packaging jobs and a two-second logical restore passed. Load failed unchanged 500/1,000 ms targets at 734/1,593 ms; diagnostics measured 737/1,573 ms. This verifies the earlier SDK-client checkpoint, not the later integrity or migration changes. OPS-07 remains open.

## Tuple/map forms and standalone defaults, 17 September 2026

[SDK-04 tuple/map acceptance](map-tuple/README.md) covers fixed positions, keyed entries, recursive reference pickers, safe rename/cancel behavior, explicit invalid-JSON recovery and schema defaults for local records. Strict checks/four builds, all 207 unit/PostgreSQL tests on a fresh database, eight headless browser journeys and three hidden/unfocused native journeys passed. Scoped Axe and six inspected captures supplement exact persisted-record assertions. The shared development database still times out in the existing lifecycle test at its unchanged 30-second limit; the same full suite passes on a temporary migrated/seeded database, which was removed afterward. Local structured-value display and nested/off-page table labels are the next open SDK-04 work.

Prior `7634be3` / [CI 35175018089](https://github.com/mateoltd/gabs/actions/runs/35175018089) completed: 206 unit/PostgreSQL tests, all 88 browser journeys, strict/build, all three unsigned package commands and a three-second logical restore passed. Load failed unchanged 500/1,000 ms budgets at 813/1,884 ms. GitHub artifact uploads failed because the account storage quota was full. This verifies the preceding migration checkpoint, not the new editors. OPS-07 and artifact delivery remain open; no production release acceptance is claimed.

## 17 September 2026: structured tables and authorized reference labels

[SDK-04 table acceptance](table-labels/README.md) covers nested/off-page labels, tuple/map display, target-wide permission invalidation, stale-response cancellation and standalone 50-record paging. Strict checks/four builds, 209 unit/PostgreSQL tests on a fresh migrated/seeded database, 13 distinct headless browser journeys and three hidden/unfocused native journeys passed. Scoped Axe and inspected wide/narrow/generated/local/native captures supplement behavior assertions. Historical captures were restored; the temporary database was removed. SDK-04 still needs richer queries, client ergonomics and broader composition.

Prior `d1941d9` / [CI 35177252607](https://github.com/mateoltd/gabs/actions/runs/35177252607) passed 207 unit/PostgreSQL tests, all 90 browser journeys, strict/build, all three unsigned package commands and a three-second logical restore. Load failed unchanged 500/1,000 ms budgets at 626/1,437 ms. All artifact uploads failed account storage quota. Those results verify the preceding editor checkpoint, not these table changes. OPS-07 and artifact delivery remain open.

## 17 September 2026: typed resource range queries

[SDK-04 range acceptance](resource-ranges/README.md) covers inferred scalar boundaries, shared HTTP/runtime validation, scoped PostgreSQL comparisons, standalone/simulator parity, generated controls and normalized offline range pages. All 212 unit/PostgreSQL tests on a fresh database, strict checks/four builds, nine distinct headless browser journeys and two distinct hidden/unfocused native journeys passed. Final compact toolbar and empty-result changes passed three browser reruns and a native rerun. Scoped Axe and six inspected captures supplement behavior checks; historical screenshots and development data were preserved. Sorting, broader SDK composition, OPS-07 and whole-product approval remain open.

Previous `0f05b97` / [CI 35179410609](https://github.com/mateoltd/gabs/actions/runs/35179410609) was still executing browser acceptance at last inspection. Its terminal result remains to be checked; this milestone does not claim remote acceptance.

## Typed resource sorting, 17 September 2026

[SDK-04 sorting acceptance](resource-sort/README.md) adds inferred scalar priorities, authenticated corporate cursors, query-bound standalone pagination and stable offline cache identity. Generated controls support reset, ordering and resource/profile isolation. Acceptance found and corrected a table-label positioning regression causing 390-pixel local dialogs to overflow, plus two development-preview readiness races.

The runtime passed 216 unit/PostgreSQL tests on a fresh temporary database. Strict checks and all four builds passed after the presentation correction. Twelve distinct headless browser journeys and two distinct hidden/unfocused native journeys passed across focused runs; final interface corrections passed nine browser cases and a native rerun, followed by a local reset/capture rerun. Nine screenshots were inspected, scoped Axe passed, and historical captures were preserved.

Earlier `0f05b97` / [CI 35179410609](https://github.com/mateoltd/gabs/actions/runs/35179410609) passed 209 unit tests and 88 browser cases but failed the five cases corrected locally here; load/restore were skipped. All three unsigned packaging commands passed, while uploads failed at account quota. Subsequent range checkpoint `39a9b37` / [CI 35180810161](https://github.com/mateoltd/gabs/actions/runs/35180810161) completed with 212 unit tests and 90 browser cases passing, those same five cases failing, load/restore skipped and uploads blocked at quota. This is scoped local evidence; complete SDK-04, OPS-07, platform parity, signed release and final UI acceptance remain open.

The pushed implementation `d0cb9746f699aefa4a2720d1163611b7aafe1298` / [CI 35182720028](https://github.com/mateoltd/gabs/actions/runs/35182720028) was rejected before any job started. GitHub's check annotation states: “The job was not started because an Actions budget is preventing further use.” This adds an external execution-capacity dependency alongside the existing artifact quota. The code has local acceptance above; remote gates remain unverified. No account budget, billing or acceptance threshold was changed. Continue independent local engineering and rerun when authorized account capacity is available.

## Reusable resource queries, 17 September 2026

[SDK-04 resource query acceptance](resource-query/README.md) adds stable typed resource clients, abortable reads, discriminated React loading/error/page states and signed custom-view composition. A delayed-response test found a development preview race that restored stale permission settings; response ordering now preserves the accepted revocation.

The implementation passed 219 unit/PostgreSQL tests across 46 files on a fresh temporary database, strict checks/four builds, two new headless browser journeys, ten existing browser regressions and two hidden/unfocused native journeys. The evidence file records final fixture/capture reruns and inspected screenshots. Existing development data and historical captures are preserved. GitHub Actions budget and artifact quota continue to block remote acceptance. SDK-04, full platform parity and final UI approval remain open.

Implementation checkpoint `655489ccb6ad94dfcdeb22bf767684934f26ce06` / [CI 35184425890](https://github.com/mateoltd/gabs/actions/runs/35184425890) again started no jobs. The verified check annotation reports that the Actions budget prevents further use. Local acceptance above passed; remote acceptance requires restored account capacity.

## SDK-04 signed host UI compatibility, 17 September 2026

[Host UI compatibility acceptance](host-ui/README.md) records signed requirement derivation, registry/installer/renderer checks, older-host initialization guards and rejected-update recovery. Verification passed 225 unit/PostgreSQL tests across 47 files, strict checks/four builds, five headless browser journeys, an expanded compatibility recovery rerun and one hidden/unfocused Electron journey. Three captures were inspected; historical screenshots and shared development data were preserved. Temporary-database functional acceptance does not close the shared-registry loading/performance gap. SDK-04, OPS-07, remote capacity dependencies, full parity and final UI approval remain open.

Implementation checkpoint `3f4507f511cc658ff0f74b57a08b43ed67958035` / [CI 35186225632](https://github.com/mateoltd/gabs/actions/runs/35186225632) started no jobs. All four jobs ended with zero steps; the verified annotation states that the Actions budget prevents further use. This is a remote-capacity failure, not fresh execution evidence.

## SDK-04 read-only resource query contracts, 17 September 2026

[Query-context acceptance](query-context/README.md) records the removal of duplicated, incomplete read-only resource query types. Strict checks/four builds, 226 unit/PostgreSQL tests across 48 files, two headless browser journeys and one hidden/unfocused Electron journey passed on temporary databases. An independently published query combines filters/ranges/sorting/pagination and rejects a changed cursor query or revoked resource read permission. Shared development data and historical captures were preserved. The [SDK-04 audit](../sdk-04-acceptance.md) keeps returned resource-record/page validation explicitly open.

Implementation checkpoint `99119e16ea03e3a1053df1c4ee9cc221fa19d1da` / [CI 35186877936](https://github.com/mateoltd/gabs/actions/runs/35186877936) started no jobs: all four jobs ended with zero steps, and the verified annotation states that the Actions budget prevents further use. Local acceptance above passed; remote acceptance still requires restored account capacity.

## SDK-04 validated resource-client results, 17 September 2026

[Resource response acceptance](resource-response/README.md) records 231 unit/PostgreSQL tests, final focused guard/copy checks, strict checks/four builds, eleven distinct headless journeys across correction runs and a hidden/unfocused native journey. Corrupted successful mutation responses retain a recoverable key; a repeated key creates no duplicate record/audit. Malformed read data never becomes a successful custom table page. Two final error captures were inspected and historical captures restored. The [SDK-04 map](../sdk-04-acceptance.md) keeps generated host/cache/journal integration open.

Implementation checkpoint `839a5e638d999f7eec3d76c325211da4c94149f1` / [CI 35188337883](https://github.com/mateoltd/gabs/actions/runs/35188337883) started no jobs. All four jobs ended with zero steps; the verified annotation states that the Actions budget prevents further use. Local acceptance above passed. Remote acceptance still requires restored account capacity.

## 17 September 2026: generated responses and original journal contracts

[SDK-04 generated response acceptance](generated-response/README.md) validates live/cached records and queued acknowledgments against the original signed module/resource/version. Invalid replies remain pending; retained packages survive updates/removal and exact-version repair. Current acceptance passed 235 unit/PostgreSQL tests across 50 files, strict checks/four builds, 20 headless browser journeys and four hidden/unfocused native journeys. Real browser and native recovery verify single record/audit/receipt effects. Final captures were inspected, false zero counts corrected and historical PNGs restored. SDK-04 is locally verified within its [map](../sdk-04-acceptance.md); SDK-05 and broader platform/release gates remain open.

## SDK-05 signed corporate host capabilities, 17 September 2026

[Corporate capability acceptance](host-capabilities/README.md) records inferred declarations, exact signed metadata, current server permission/version checks and narrow web/native effects. Local verification passed 238 unit/PostgreSQL tests, 11 final focused tests, strict checks/four builds, nine headless browser journeys and five hidden/unfocused native journeys. Accepted exports write/download exact content; revoked permissions and abandoned views prevent delayed effects. Real TLS verification now uses discovered peer IDs. Wide/narrow/native captures were inspected; historical captures and existing development services/data were preserved. Native save-dialog selection and notification presentation use test sinks to avoid interrupting the desktop. The [SDK-05 map](../sdk-05-acceptance.md) remains active for the remaining standalone/offline, developer, adapter and LAN work. Full parity and final UI approval remain open.

Source checkpoint `637f0ee06b82786176c4d045ddbb6600a7f9d26a` / [CI 35193234094](https://github.com/mateoltd/gabs/actions/runs/35193234094) started no jobs. All four ended with zero steps and the verified annotation says the Actions budget prevents further use. Local corporate capability acceptance remains distinct from remote release acceptance.

## SDK-05 host capability simulation, 17 September 2026

[Host simulator acceptance](host-simulator/README.md) adds inferred result fixtures, authored CLI scenarios and live preview permission/offline controls without invoking device effects. Strict checks/four builds, 240 unit/PostgreSQL tests, two module-owned CLI scenarios, five headless regressions and both affected preview journeys after visual corrections passed. Scoped Axe and final wide/narrow captures were inspected; historical evidence and shared services/data were preserved. The simulator does not grant real device authority or close the standalone/offline, native LAN, profile or release gates. SDK-05 and the parity goal remain active.

Source checkpoint `e2379a1c6e7f665a463c4c9077dcd2b4e1fde22a` / [CI 35194471793](https://github.com/mateoltd/gabs/actions/runs/35194471793) started no jobs. All four ended with zero steps; the verified annotation states that the Actions budget prevents further use. The local results above remain valid, while remote acceptance requires restored account capacity.

## SDK-05 standalone reference grants, 17 September 2026

[Standalone reference acceptance](local-reference-grants/README.md) records encrypted exact-version consent, signed provider verification, scoped read snapshots, stale-session rejection and data-preserving revocation/update/uninstall. Strict checks/four bundles, 243 unit/PostgreSQL tests across 53 files, 13 headless browser journeys and four hidden/unfocused native journeys passed on temporary databases. The offline Contacts/Projects journey passes grant, lock/unlock, linked-record creation and revocation; scoped Axe and wide/narrow/native captures were reviewed. Historical captures and shared development data were preserved. SDK-05, remote capacity dependencies, full parity and final UI approval remain open.

Source checkpoint `7429b7bb127b322b41b29541b798c55fb576a402` / [CI 35208850942](https://github.com/mateoltd/gabs/actions/runs/35208850942) started no jobs. All four ended with zero steps; check `105161193657` reports: “The job was not started because an Actions budget is preventing further use.” Local acceptance above passed; remote acceptance requires restored account capacity.

## SDK-05 installation-time reference consent, 17 September 2026

[Migration grant acceptance](local-migration-grants/README.md) records prospective exact-release consent, verified final provider snapshots, encrypted pending decisions and atomic installation/grant commit. Strict checks/four bundles, 244 unit/PostgreSQL tests across 53 files, 14 headless browser journeys and four hidden/unfocused native journeys passed on temporary databases. The new UI journey rejects missing consent without changing the old installation, cancels a reviewed update, locks/unlocks and resumes it with readable linked data. Worker acceptance proves revocation prevents saved consent from being reinstated and completed retries do not duplicate receipts or migrations. SDK-05 and full parity remain open for the remaining capability and service boundaries; final UI approval remains separate.

Wide/narrow consent captures, scoped Axe and the final native result were reviewed. A capture-only rerun passed after waiting for the selector’s collapsed state and completing finite screenshot animations; the app’s control behavior was unchanged. Historical captures and shared development data were preserved.

Source checkpoint `7418548903a540345958152f7f48948bb3e652dc` / [CI 35210471760](https://github.com/mateoltd/gabs/actions/runs/35210471760) started no jobs. All four ended with zero steps; check `105166518239` reports: “The job was not started because an Actions budget is preventing further use.” Local acceptance above passed; remote acceptance requires restored account capacity.

## Architecture reconciliation, 17 September 2026

[Architecture acceptance](architecture/README.md) records the move to responsibility-owned SDK, client, server, shell and UI trees; explicit product composition injection; generalized package/module/environment checks; grouped tests and tooling; and stable signed/runtime interfaces. The frozen OpenAPI, generated client declarations and token values match checkpoint `69aa1a3` byte-for-byte. Desktop output filenames remain stable.

Local acceptance passed 257 unit/PostgreSQL tests, 5 focused CLI/distribution tests, six architecture fixtures, seven independent checker probes, all four builds and a frozen-lockfile install. The broad browser run passed 99/111 before 12 stale worker-route fixtures were corrected; those 12 passed in the focused repair run. A separate intermittent closed-Select accessibility failure was corrected and the affected accessibility/focus/UI set passed 36/36 across three repeats. The selected native run passed 10/13 before three migrated fixture expectations were corrected; the repair run passed 4/4. All native runs were minimized and unfocused.

Architecture captures were reviewed separately and historical screenshots restored. This verifies the migration and preserved local-services behavior. It does not claim full product parity, remote CI, signed release acceptance or final UI approval.

## Local device grant authority, 17 September 2026

[Local device grants](local-device-grants/README.md) add encrypted profile decisions bound to exact releases and aliases, with fresh lock/revocation checks before effects. Local acceptance passed 36 final local/host unit tests, two headless browser journeys plus the expanded grant proof rerun, and all four builds with strict environment/boundary checks. The new browser proof verifies offline persistence, signature-bound installation, revoke/regrant, cross-window invalidation, update/rollback, uninstall/reinstall and retained records.

SDK-05 remains active: consent UI, worker message brokering, desktop effect integration and corporate offline capability leases remain required. This milestone grants no new production-facing device effects.

## Local device consent, 17 September 2026

[Local device consent](local-device-consent/README.md) connects exact-release declarations to profile-owner controls. Final acceptance passed two headless consent/service journeys, one hidden/unfocused native journey, scoped Axe and inspected wide/narrow/native captures, plus strict checks and all four builds. An earlier pair also reran the unchanged grant-authority proof. Consent works offline and survives lock/unlock; corrupted stored packages block grants while saved access remains revocable. No standalone device effects were exposed or verified. SDK-05 remains active for bounded worker brokering, native effects and corporate offline leases.

## Standalone device request journal, 17 September 2026

[Standalone device requests](local-device-requests/README.md) connect inferred worker requests to atomic records/receipts and an encrypted host journal. Processing releases the write queue, rechecks consent, bounds interaction and preserves uncertain outcomes. Device-only retries preserve business writes. Verification passed 265 full unit/PostgreSQL tests before final hardening, 42 final focused tests, strict checks/four builds, three headless journeys plus expanded page-termination recovery, and two hidden native regressions. Real standalone device effects and owner recovery UI remain required under SDK-05; controlled adapter callbacks do not establish OS or LAN acceptance.

## Standalone device effects and recovery, 17 September 2026

[Actual local effects](local-device-effects/README.md) connect the encrypted request journal to browser downloads and native filesystem writes, with owner processing/cancellation/retry controls. Three headless journeys and two hidden/unfocused native journeys passed, alongside strict checks/four builds, scoped Axe and three inspected captures. Revocation during a held native dialog prevents writing; lock/unlock preserves the original business record and recovers uncertainty. Native dialog selection is controlled to avoid desktop interruption. Actual OS notifications, corporate offline leases, standalone simulation and positive corporate LAN remain open under SDK-05. The corporate regression required a renderer refresh after direct database regrant, matching its browser counterpart. Historical captures were restored.

## Standalone device development simulation, 17 September 2026

[SDK/CLI/preview acceptance](local-device-simulator/README.md) verifies real local transaction handlers with simulated device consent and outcomes. The final focused suite passed 64 tests across 16 files, and two authored CLI scenarios passed. Three existing preview regressions passed; the standalone journey passed after waiting for the rebuilt worker generation before reading reset state. Scoped Axe and wide/narrow captures were inspected. No real device effects, native acceptance or final product UI approval are claimed by simulation results. Corporate offline host leases and the rest of SDK-05 remain open.

## Corporate capability lease authority in progress, 17 September 2026

[Authority milestone](capability-leases/README.md) adds signed exact-context leases, explicit offline declarations, separate online signing keys and audited server issuance. Final combined acceptance passed 17 tests across 7 files after expiry/replay hardening, including server/verifier/host/policy and SDK regressions. Strict checks and all four builds pass, and API schemas were regenerated after PostgreSQL recovered without an assistant-initiated OrbStack restart. Browser/native lease integration and real offline acceptance remain required. No offline client completion is claimed.

## Corporate lease client guard and browser persistence, 18 September 2026

[Client store acceptance](client-capability-leases/README.md) verifies exact signed grants, live profile/policy checks, durable expiry/clock handling and scoped IndexedDB persistence. Twenty-eight focused checks across eight files and two headless browser tests pass, alongside strict checks and four builds. The browser harness covers real storage/restart/cross-tab/purge behavior with test-signed grants; the second journey preserves live corporate export behavior. API schemas include the independently configured lease issuer. Product acquisition, connected invalidation and actual web/native offline effects remain required under SDK-05. No Electron or foreground browser was launched.

## Current architecture checkpoint review, 18 September 2026

[Fresh Sol xhigh and parent review](architecture/README.md#current-checkout-audit-18-september-2026) found no further structural correction needed. Checkpoint `4160ff0` preserves unfinished feature work separately. Nine boundary fixtures and strict checks/four builds passed again; no UI or application source changed in this audit. Employee recovery and full parity remain unverified.

## Architecture follow-up review, 18 September 2026

[The Sol xhigh audit and parent review](architecture/README.md#follow-up-architecture-review-18-september-2026) confirmed the reorganized ownership and corrected two checker gaps: dormant portable source coverage and conditional wildcard export resolution. Nine focused boundary fixtures and strict checks/all four builds passed. No product code or UI changed and no browser or desktop was launched. Full parity remains open.

## Real browser corporate offline capabilities, 18 September 2026

[Browser integration acceptance](browser-capability-leases/README.md) verifies real API lease acquisition, cached-view restart and file export, connected revocation, no fallback after a known denial, corrupted signatures and expiry locking. Thirty-two focused checks, five headless journeys, one hidden native online regression and strict checks/four builds pass. Scoped Axe and wide/narrow captures were inspected; the readiness text names the permitted action kinds and dated expiry. The native regression preserves the existing online boundary and is not offline acceptance. A recovery rerun exposed a corruption-fixture race; after taking the cache lock during mutation, both affected browser journeys passed twice with the same negative assertion. Issuer-wide key propagation across cached workspaces/accounts is still missing and precedes independently trusted native authority. The remaining SDK-05/GOV/OPS work stays open.

## Shared issuer capability trust, 18 September 2026

[Issuer trust acceptance](issuer-capability-trust/README.md) verifies cross-account/workspace replacement, restart, retired-key rejection, delayed observations/renewals, failed persistence and legacy-cache renewal. Twenty-two focused tests, two headless browser journeys and strict checks/four builds passed. The real product export journey retained its scoped Axe/overflow checks, and wide/narrow captures were inspected. Public trust survives account removal; no desktop was launched. Native offline authority and remaining SDK-05/OPS acceptance stay open.

## Native corporate offline capabilities, 18 September 2026

[Native authority acceptance](native-capability-leases/README.md) verifies independent main-process acquisition, private protected persistence, configured-issuer binding, process restart, actual offline file export, expiry and revocation after controlled dialogs. Thirty-three focused tests, three browser journeys, five hidden/unfocused native journeys and strict checks/four builds passed. The affected browser/native readiness journeys were rerun after narrowing readiness to verified aliases. Native scoped Axe and screenshot review passed. Network failures and dialogs were controlled; real providers, OS notification presentation and packaged cross-OS recovery remain unverified. SDK-05 and full parity remain active.

### 18 September 2026: SDK-05 corporate lease simulation

Typed declared allowances, deterministic expiry, held-action rechecks and CLI/preview renewal/revocation/source reset now have [scoped acceptance](corporate-lease-simulator/README.md). Verification passed 22 focused tests, two module-owned CLI scenarios, three headless preview journeys and strict checks/four builds. Wide/narrow Axe, keyboard activation and inspected captures pass; no device effects or desktop windows occurred. Next: official module capability adoption and administrator review. Actual authority/profile/LAN/release gates retain their independent evidence and remaining work.

### 18 September 2026: SDK-05 scoped Orders export delivery

[Scoped acceptance](order-export-delivery/README.md) verifies server-owned file content, non-auditing readiness checks, post-dialog authority, stale-view cancellation and generic CSV denial. Five unit/session tests, five browser journeys, five hidden native journeys and the affected final native rerun pass, with strict builds and regenerated API contracts. Final native error text/Axe and screenshot inspection pass. The [official effect audit](../official-capability-adoption.md) keeps signed capability adoption and administrator review open; this compatibility prerequisite does not close SDK-05 or parity.

## 18 September 2026: official Orders capability release

[Orders 2.1.0 acceptance](orders-capability-release/README.md) verifies the signed public export capability, shared browser/native host bridge and protected pinned 2.0.0 behavior. Strict builds, 315 unit/PostgreSQL tests, four distinct headless and four hidden native journeys passed. The missing pin-fixture idempotency key was corrected before the affected browser pair passed. Scoped native Axe and four inspected captures pass. SDK-05 administrator review and all broader parity gates remain open; no production release or final UI approval is claimed.

## 18 September 2026: administrator capability review

[Scoped acceptance](capability-review/README.md) verifies signed release inspection, saved grant/denial explanations, matrix edits, offline limits and native IPC. Passed 316 full unit/PostgreSQL tests, seven final guard checks, strict builds/API generation, 13 distinct headless journeys with affected reruns and three hidden native journeys. Scoped Axe and six inspected captures pass. The policy UUID validation defect is fixed locally; the broader standard-format defect is reproduced and reopens SDK-04 as SDK-04-FMT. Full parity remains unachieved.

## Portable schema formats, 18 September 2026

[SDK-04-FMT evidence](schema-formats/README.md): 341 unit/PostgreSQL tests across 69 files, strict environment checks/four builds, three distinct headless journeys across correction runs, one hidden native journey, scoped Axe and three inspected captures. Shared format validation now accepts valid declared formats and rejects invalid values or unsupported declarations without losing schema constraints, accepted records or retry receipts. The acceptance record explains initial harness failures and exact limits. SDK-04's reopened format gate is closed; full parity remains active.

## Native LAN lifecycle and SDK relay, 18 September 2026

[Scoped acceptance](native-lan/README.md) passed 345 full unit/PostgreSQL tests before final review, six focused transport/session tests after lease-expiry hardening, strict environment/boundary checks and all four build targets. One headless browser and two distinct hidden/unfocused Electron journeys passed across affected reruns. The new journey uses a signed independent SDK view, real mutual TLS, workspace-scoped provisioning, Settings enablement, third-port fallback, denied foreign/revoked requests, concurrent protected receipts, offline-lease revocation and logout. Scoped Axe and two inspected captures pass. No production styles changed.

SDK-05-LAN is verified within this evidence; SDK-05 and OPS-01 remain open for quarantine consumption, verified artifact reuse, authoritative pending submission/recovery, peer coordination, offline authority and deployment/platform acceptance. This does not establish real-provider identity, packaged multi-device networking or full parity.

## Received LAN draft recovery, 18 September 2026

[Scoped acceptance](lan-recovery/README.md) passed 351 full unit/PostgreSQL tests before final input-bound review, 12 final transport/session/recovery checks, strict environments/boundaries/copy checks and all four builds. One headless and two distinct hidden native journeys passed across affected reruns. Real TLS receipts require explicit review and current server acceptance; the new native journey proves lost-response retry across process restart/reauthentication with exactly three records and three creation audits, dependency order, conflicts, unrelated progress, permission revocation and accepted-receipt dismissal. Scoped Axe and wide/narrow/list captures passed inspection.

SDK-05-LAN-REC is verified for same-account administrator recovery. Verified package reuse, full receipt lifecycle and capacity, inactive-version/remote-dependency reconciliation, broader employee authority, offline LAN, peer coordination and explicit-sign-out/profile recovery remain open. Full parity and the later UI-refinement goal are unchanged.


## 18 September 2026: verified received LAN packages

[SDK-05-LAN-PKG acceptance](lan-packages/README.md) connects resumable bounded encrypted package chunks, utility assembly/signature checks, fresh authoritative metadata and the regular durable installer. A real independently built executable survives partial transfer and process restart, then installs with zero full-package registry requests and a verified server installation record. Legacy package receipts retain verified compatibility.

Verification: 360 unit/PostgreSQL tests before final damaged-index recovery, 20 final focused checks, regenerated API schemas, strict checks/four builds, three distinct hidden native journeys plus the affected package rerun, and two headless installation regressions. Existing recovery Axe and inspected wide/narrow captures pass; historical artifacts were preserved. No UI redesign, external publication or production acceptance occurred. Next: full pending-receipt lifecycle/capacity, then peer coordination and the remaining SDK-05/OPS-01 gates. Full parity and the later UI goal remain open.


## 18 September 2026: received-draft lifecycle and capacity

[SDK-05-LAN-LIFE acceptance](lan-life/README.md) adds bounded encrypted archiving/restoration, account-scoped recovery files and explicitly confirmed copy deletion while preserving uncertain outcomes and original retry identities. Interrupted moves retain a source copy; full inbox/archive limits never evict pending work. Exact archived network retries remain acknowledged without reopening the inbox.

Verified: 365 unit/PostgreSQL checks before the final busy-state accessibility annotation, final strict checks/four builds, three distinct hidden native journeys plus the affected recovery rerun, one headless Settings regression, scoped Axe and five inspected captures. Native recovery verifies real filesystem round trips, restart, duplicate-safe server effects, ownership rejection and capacity preservation. Controlled dialogs never opened foreground windows. Historical captures were preserved. Peer coordination, cross-device dependencies, inactive releases, employee/offline authority, sign-out/profile recovery and full parity remain open; the later UI goal remains queued.

## Bounded peer discovery, 18 September 2026

[OPS-01-MESH acceptance](lan-discovery/README.md) verifies workspace-bound mutual-TLS peer exchange, exact-pin hints, shared scan reservations, coordinator loss, bounded probe concurrency and stop/start without budget reset. Strict checks/four builds, 370 unit/PostgreSQL tests and three hidden native journeys passed. Existing SDK relay, resumable signed-package installation and received-draft recovery retain their actual authority and restart acceptance. A fresh Settings capture was inspected; no product UI changed.

Partition-table convergence is a unit check, not multi-host production partition evidence. The protocol documents startup, clock, process and partition limitations. Persistent shell status, employee/offline authority, deployment certificates/platforms and all other open parity gates remain required.

## Persistent LAN peer status, 18 September 2026

[OPS-01-STATUS acceptance](lan-status/README.md) verifies a compact native workspace indicator, shared Settings status, main-owned lifecycle notifications, scoped stale-result invalidation and keyboard focus retained during peer changes. Strict checks/four builds, 370 unit/PostgreSQL tests, three distinct hidden native journeys with affected reruns and the headless Settings regression pass. Inspected wide/narrow/high-contrast captures and scoped Axe accompany actual TLS peer arrival/removal, one-minute heartbeat, workspace switching, subscription cleanup, lease revocation and logout evidence.

The recovery regression's archive assertion now waits for the visible operation result. Final renderer corrections have fresh strict/native acceptance after the full unit run. SDK-05-LAN-AUTH is next for explicit employee grants and protected offline startup/relay. Full parity and the separately queued UI-refinement goal remain unchanged.

## Signed LAN module leases, 18 September 2026

[SDK-05-LAN-LEASE acceptance](lan-leases/README.md) verifies explicit signed offline declarations, shared server/verifier eligibility, exact-release compatibility revision 2 and real provisional TLS transfer while the main-process API transport is unavailable. Connected permission revocation prevents subsequent offline replay. Strict checks/four builds, 375 distinct unit/PostgreSQL cases across the initial run and corrected focused rerun, two hidden native journeys and two headless browser journeys passed. Scoped Axe and an inspected capture accompany the native proof.

This milestone requires an already enabled administrator transport. SDK-05-LAN-AUTH remains active for employee grants and protected offline startup/restart; broader recovery, deployment and parity gates remain open. Historical regression captures were preserved.

## Module-granted LAN startup and offline restart, 18 September 2026

[SDK-05-LAN-AUTH acceptance](lan-authority/README.md) verifies non-administrator module selection, protected native offline restart, actual provisional TLS relay, expiry/clock rejection, reauthentication and fresh grants, plus server-confirmed revocation and rejected offline replay. Offline Settings now exposes device preferences and local transport controls; corporate policy/billing remain connected. A reproduced root-redirect race no longer overwrites a newer page selection.

Passed: 385 full unit/PostgreSQL checks, 25 final focused checks, strict checks/four builds, three distinct hidden native journeys with affected reruns, two headless browser journeys, scoped Axe and inspected wide/narrow captures. Final routing and startup-guard corrections follow the full unit run and have focused/native/browser acceptance. Historical artifacts were restored. SDK-05-LAN-EMP-REC is next for employee received-draft recovery; wider profile, deployment and full parity remain open.

## Employee received-draft recovery, 18 September 2026

[SDK-05-LAN-EMP-REC acceptance](lan-employee-recovery/README.md) verifies ordinary employee receipt review, protected offline archive/restoration/file round trips, filtered payloads/counts, expiry, permission rechecks after file dialogs and authoritative duplicate-safe retry. The extended native journey passed twice after correcting a real late-redirect race; a deterministic browser case covers that race separately.

Evidence: 397 unit/PostgreSQL checks, strict environment checks/four builds, three distinct hidden native journeys, nine distinct headless controls/motion cases across affected runs, scoped Axe and inspected wide/narrow/revoked captures. Historical screenshots were restored. Fixture corrections and the route-fix timing relative to the full suite are recorded in the scoped report. SDK-05-LAN-RECON is next; full parity and the later UI refinement remain open.

## Remote prerequisites and original-release recovery, 18 September 2026

[SDK-05-LAN-RECON acceptance](lan-reconciliation/README.md) verifies read-only authoritative prerequisite lookup, exact signed historical contracts, explicit compatible rollout policy and original retry recovery after mandatory update/process restart. Current authority still applies; unknown dependencies and unconfirmed incompatible writes cannot report success.

Passed: 400 unit/PostgreSQL checks across 74 files, strict checks/four builds, three hidden/unfocused native journeys, two headless browser journeys, scoped Axe and inspected wide/narrow captures. Native acceptance exposed a missing recovery-version query allowance in the desktop validator; the narrow correction retains malformed-version rejection and passed the complete final suite. Historical captures were restored. OFF-01 is the next independent engineering item; full SDK-05, platform parity and the later UI-refinement goal remain open.

## Generated offline dependency capture, 18 September 2026

[Scoped OFF-01 evidence](offline-dependencies/README.md) verifies project/task/comment dependency capture, durable atomic ordering, browser reload and hidden native offline process restart. A lost successful parent reply retries under the original key; the server rejects a revoked comment write while unrelated work succeeds. Both journeys assert exactly three accepted records and audit entries.

Passed: 402 unit/PostgreSQL checks across 74 files, strict checks/four builds, six final headless journeys and one hidden/unfocused native journey, scoped Axe and inspected wide/narrow captures. Historical regression artifacts were restored. Test corrections concern required status selection and different native process-start/reload navigation behavior. OFF-01 remains active for conflict comparison and the remaining [workflow acceptance](../offline-workflows.md); full parity and final UI refinement remain open.

## Explicit resource conflict review, 18 September 2026

[Scoped OFF-01 conflict evidence](conflict-review/README.md) verifies deliberate original/local/server choices, preserved disjoint server changes, legacy missing-original input and durable choices/edits through browser reload and hidden native process restart. Another server overlap produces another conflict; the final record retains the newest unrelated server data and the user's additional review edit.

Passed: 405 unit/PostgreSQL checks across 75 files, strict checks/four builds, seven distinct headless journeys with both affected conflict cases rerun after prototype-field hardening, and two final hidden/unfocused native journeys. Scoped Axe and inspected wide/narrow captures pass; historical images were restored. OFF-01 remains active for uncertain-outcome classification, independent review retention and the remaining [workflow map](../offline-workflows.md). Full parity and later UI refinement remain open.


## OFF-01 durable delivery through denial, 18 September 2026

[Journal delivery acceptance](journal-delivery/README.md) verifies dispatch persistence before effects, restart-safe uncertainty after a lost reply and later denial, independent work, dependency waiting and exact receipt recovery when authority returns. Full isolated verification passes 413 checks across 76 files, strict checks/four builds, six headless and three hidden native journeys. Current PostgreSQL evidence has exactly one effect/audit per accepted change. Missing-receipt settlement, permanent revocation and other OFF-01 gates remain open; this is scoped progress, not parity completion.


## OFF-01 authoritative settlement, 18 September 2026

[Settlement acceptance](attempt-settlement/README.md) verifies both execution/cancellation race orders with observed PostgreSQL lock waits, atomic cancellation audit/rollback, cancelled-receipt exclusion and current authority. The generated UI survives a lost settlement reply and restart, blocks late original effects, reviews a corrected contact, reconnects its dependent note, and recovers an already committed receipt. Full verification passed 418 tests across 77 files, strict checks/four builds, six headless and three hidden native regressions. Extended affected journeys and scoped visual/accessibility checks passed. Migration 029 requires cancellation-aware server rollback targets. Direct online recovery, other OFF-01 work, hosted release acceptance and full parity remain open.

## 18 September 2026: OFF-01 direct editor and archive recovery

[Evidence and limits](direct-recovery/README.md): 420/420 unit/PostgreSQL tests across 78 files, strict checks/four builds, seven headless browser journeys and four hidden/unfocused native journeys pass. Direct lost-reply attempts retain original keys through actual permission denial/conflict; authoritative settlement recovers acceptance or fences a correction. Real PostgreSQL audit counts verify no duplicate effects. Fresh conflicts and cancelled updates expose explicit comparison, preserving unrelated remote edits. Keyboard confirmation/return, scoped Axe and wide/narrow web/native captures were inspected after removing stacked dialogs.

The first fixture was corrected to revoke permission during submission because the UI correctly blocked an already-known denial. Product source remained frozen during final serialized acceptance. Historical captures were restored. Offline storage stays disabled in the new direct journey; in-memory direct attempts do not establish process-restart, sign-out or profile recovery. OFF-01/OFF-03 and full parity remain active/open; this is not final UI approval.

## 18 September 2026: OFF-01 independent saved reviews

[Evidence and limits](review-drafts/README.md): 422/422 unit/PostgreSQL tests across 78 files, strict checks/four production builds, eight headless browser journeys and five hidden/unfocused native journeys pass. Queued and direct online comparisons retain independent choices/input and ordinary drafts across reload/process restart, resume offline and consume only their own saved review on acceptance. A signed local online-only fixture verifies disabled offline submission and real server effects/audit counts. Storage acceptance includes legacy promotion, collision preservation, interrupted writes, stale writers and scope rejection.

Scoped Axe, keyboard resumption and eight wide/narrow web/native captures were inspected. Initial extended acceptance exposed misleading online-policy button state; final gates passed after both the label and disabled behavior were corrected. Historical captures were restored, product source stayed frozen during serialized final runs, and disposable databases were removed. Saved-review durability does not establish unresolved direct-request or sign-out/profile recovery. OFF-01 and full parity remain active; UI refinement has not started.

## Architecture checkpoint during collision work, 18 September 2026

[Fresh independent review and parent verification](architecture/README.md#collision-work-checkpoint-audit-18-september-2026) preserve checkpoint `c219fc00`, confirm the existing ownership layout, and pass nine architecture fixtures plus strict checks/four builds. No source or UI changes were justified. Collision behavior, full parity and the later UI-refinement goal remain outside this acceptance.

## Journaled create collisions, 18 September 2026

[OFF-01 collision acceptance](create-collisions/README.md) passed 442 unit/PostgreSQL tests across 79 files, strict checks/four builds, eight headless browser journeys and five hidden native journeys on final source. Real server collision, lost cancellation reply, restart, corrected input, remapped dependent work, unchanged existing records and exact audit counts are covered. Keyboard, scoped Axe and eight wide/narrow captures were inspected. Historical captures were restored; no stylesheet changed. Direct no-cache collisions and the remaining offline/full-parity gates are not accepted by this milestone.

## Direct create collisions, 18 September 2026

[OFF-01 direct collision acceptance](direct-create-collisions/README.md) verifies failed and cancelled direct creates without enabling offline storage. Explicit separate-record recovery fences the original key, preserves corrected input through a lost cancellation reply and reconnect, retains an uncertain replacement's own retry identity, and handles repeated definitive collisions. PostgreSQL proves seven intended records, four cancellations, unchanged occupied records and exact audit counts.

Final strict checks/four builds, nine headless browser journeys and six hidden/minimized native journeys passed. The full unit/PostgreSQL suite passed 442 tests before the final presentation-only removal of duplicate errors; runtime files were unchanged. Keyboard, scoped Axe and twelve wide/narrow captures were reviewed, historical screenshots restored and disposable databases removed. The initial test's offline expectation was corrected to match the existing no-cache privacy lock. Direct state remains in memory; OFF-01/OFF-03 and full parity remain open. This is not final UI approval.

## Structured conflict comparison, 18 September 2026

[OFF-01 structured comparison acceptance](structured-conflicts/README.md) verifies nested objects, arrays, map keys/tuples, union branches and optional removal, partially saved choices across reload/native restart and offline resumption, authorized reference labels and later disjoint server changes. Real permission revocation exposed a retained target-label cache on early local denial; that path now clears the same current/legacy entries as server denial while preserving review input and choices.

Final verification passed 442 unit/PostgreSQL tests across 79 files, strict checks/four builds, seven headless browser journeys and four hidden/minimized native journeys. Exact PostgreSQL result/version/audit assertions and scoped Axe passed; six expanded comparison/result captures were inspected. The test now waits for the asynchronous review and verifies visible expanded labels rather than hidden text. Historical captures were restored and isolated databases removed. No stylesheet changes; OFF-01, full parity and later UI refinement remain open.

## 18 September 2026: OFF-01 nested cross-module capture

[Cross-module capture acceptance](cross-capture/README.md) verifies nested references under explicit grants, no offline choices before prior authorization, connected revocation/cache invalidation, browser reload/native offline restart, exact retries after a lost reply, unrelated progress, reviewed continuation and collision remapping across module boundaries. Real PostgreSQL assertions verify nine records and nine corresponding create audits.

Final acceptance passed 445 unit/PostgreSQL tests across 79 files, strict checks/four builds, nine headless browser journeys and four hidden/minimized native journeys. Scoped Axe passed and six captures were inspected. Product source stayed frozen during serialized runs; historical captures were restored. Acceptance exposed and fixed empty Select popup interception and delayed dispatch of older dependents after a reviewed replacement. Same-record ordering, ambiguous drafts, archived/custom recovery and broader offline/profile/release gates remain required. OFF-01 and full parity stay open.

## 18 September 2026: OFF-01 same-record queued edits

[Same-record acceptance](record-order/README.md) verifies atomic ordered capture, per-change saved-input inspection, browser reload/native offline restart, exact-key recovery after a lost reply, explicit overlapping conflict review, dependent continuation and unrelated progress. Original calls and server snapshots stay intact; PostgreSQL assertions verify final data/versions and five update audits.

Final verification passed 447 unit/PostgreSQL tests across 80 files, strict checks/four builds, nine headless browser journeys and six hidden/minimized native journeys. Keyboard disclosures, scoped Axe and six inspected captures passed. Product source remained frozen during serialized final acceptance; historical screenshots were restored. Archive interactions/recovery, legacy unsequenced journals, colliding-create same-record descendants, ambiguous drafts and broader offline/profile/release gates remain required. OFF-01 and full parity stay open.


## 18 September 2026: OFF-01 archived-input recovery

[Archived-input acceptance](archived-input/README.md) verifies queued/direct archived targets, original input/base/version exports, cached offline restart, uncertain-request snapshots, pending-edit archive preflight and original-resource permission recovery across tab changes. Final product source passed 448 unit/PostgreSQL tests, strict checks/four builds, twelve distinct headless browser journeys and seven hidden/minimized native journeys. One stale browser wording assertion was corrected and the case rerun successfully; an earlier transient native reconnect failure did not reproduce with added diagnostics or in final acceptance. Scoped Axe and ten wide/narrow captures were inspected. Existing styles and historical captures are preserved.

The native generic recovery export still lacks independent current authority checks after the save dialog. Renderer guards and valid file bytes do not establish that boundary; host/browser recovery authorization is the next required OFF-01/OFF-03 item. Full parity and final UI refinement remain open.


## 18 September 2026: OFF-01 scoped recovery export

[Recovery-export acceptance](recovery-export/README.md) verifies current native scope/read/dependency authority across delayed dialogs, renderer snapshot tampering, protected offline restart, expiry and logout. Browser identity/policy refresh, persisted denial, stale-view cancellation and offline expiry also pass. The former unscoped native bridge rejects file writes; old-schema input remains exportable through the scoped action when authorized.

Final validation passed 457 unit/PostgreSQL tests across 81 files, strict checks/four builds, nine headless browser journeys and nine hidden/minimized native journeys. Existing Orders export and real TLS LAN acceptance passed. Initial wiring/harness failures and non-reproduced setup timeouts are recorded in the detailed evidence. Four recovery captures were inspected for continuity; historical screenshots were restored, with no style/layout changes. OFF-01, OFF-03 and full parity remain open.


## 18 September 2026: legacy journal ordering recovery

[Acceptance record](legacy-order/README.md): durable same-record scheduling repair, retained exact retry identities, explicit authoritative outcome recovery, unrelated progress, offline browser/native restart and reviewed continuation. An actual previously committed request is recovered without another execution request; PostgreSQL values, versions and duplicate-free audits are asserted.

Final checks: 463 unit/PostgreSQL tests across 81 files, strict checks/four builds, seven headless browser journeys and five hidden/minimized native journeys. Scoped Axe, keyboard disclosure and six inspected captures passed; historical screenshots were restored. Initial unit fixture protocol mistakes were corrected without weakening validation. OFF-01 and full parity remain active; colliding-create same-record descendants, arbitrary commands and broader recovery/release acceptance remain required.


## 18 September 2026: later edits after create collisions

[Acceptance record](collision-edits/README.md): per-edit target selection, durable original-input preservation, explicit review before execution, prerequisite checks, chosen-target archive guards and archived-source export. Browser/native UI journeys verify both target choices after lost replies and restart; server values, versions and audits establish the effects.

Final checks: 468 unit/PostgreSQL tests across 81 files, strict checks/four builds, seven distinct headless browser journeys and six final hidden/minimized native journeys. The browser total includes a corrected dialog-title rerun after six other cases passed. Nine captures, scoped Axe, keyboard and overflow checks were inspected; historical screenshots were restored. OFF-01 remains active, with ambiguous ordinary drafts next and the wider recovery/release gates still required.


## 18 September 2026: ordinary drafts during create-collision recovery

[Acceptance and limits](collision-drafts/README.md): explicit per-draft choices use the retained signed schema, preserve original input/targets and atomically save independent reviews without inventing operations. Stale editors cannot overwrite moved slots. Browser/native journeys cover lost settlement replies, restart, separate/existing targets, offline review resumption and exact server values/versions/audits. Legacy/online input remains unchanged when prior delivery or schema meaning is uncertain.

Final product validation passed 474 unit/PostgreSQL tests across 81 files, strict checks/four builds, nine headless browser journeys and eight hidden/unfocused native journeys. Nine further collision repetitions passed with diagnostic assertions. Two earlier mixed native runs intermittently failed the linked-only dialog-close check; their cause remains unestablished and is retained as a reliability concern, not declared fixed by successful reruns. The diagnostic assertion now reports any remaining dialog text without changing its timeout or empty-dialog criterion. Scoped Axe/keyboard/overflow checks and eight inspected captures support continuity. Historical screenshots were restored. OFF-01 and full parity remain active; UI refinement has not started.


## 18 September 2026: opaque retry identities

[Acceptance record](request-keys/README.md): shared desktop/settlement/receipt bounds preserve punctuation and exact identity, while native transport prevents header normalization and JSON validators reject NUL before persistence. PostgreSQL/API tests cover exact replay/settlement, resource and operation receipts, current authority and malformed keys. The real TLS LAN/native journey verifies renderer IPC replay, remote prerequisites, lost replies, process restart and old-release acceptance without duplicate records/audits.

Final source passed 475 unit/PostgreSQL tests across 81 files, strict checks/four builds, two headless browser regressions and two hidden/unfocused desktop journeys. API schemas were regenerated, formatting passed and historical screenshots were restored. No UI/style source changed; the prior intermittent linked-dialog concern is not claimed fixed. OFF-01 remains active for queued custom-operation capture/recovery and the wider offline map; full parity and UI refinement remain open.


## 18 September 2026: queued-command SDK/storage foundation

[Acceptance record](queued-commands/README.md): typed provisional capture/lookup, original signed operation schemas, exact retry identities, explicit/reference prerequisites, declared-error validation, scope/authority checks and original contract retention. A real PostgreSQL/API Orders journey captures a draft, loses the successful response, reconstructs the client over its stored journal and retries without duplicate orders, receipts or creation audits. The storage fixture for that integration is in memory; it does not prove browser/SQLite process durability.

Final verification passed 487 unit/PostgreSQL tests across 82 files, strict root/browser/Node/preload/worker checks, boundary/copy checks and four builds. Five headless browser and four hidden/unfocused desktop resource-recovery regressions passed before the final additive capture-error guard; affected storage and UI paths were unchanged afterward. Formatting and documentation links passed, isolated databases were removed and historical captures restored. Initial typing/fixture/namespace assertion corrections are recorded in the detailed evidence. No UI/style source changed. OFF-01 remains active for host wiring and end-to-end command recovery; full parity and UI refinement remain open.


## Queued-foundation architecture review, 18 September 2026

[Checkpoint and independent review](architecture/README.md#queued-foundation-checkpoint-review-18-september-2026) preserve clean `badb5bb` and confirm the current SDK/client ownership. Sol xhigh and parent review found no further structural correction. Nine fixtures and fresh strict checks passed; four build tasks succeeded from the valid Turbo cache. No product source or UI changed. OFF-01 and full parity remain open.


## Custom-view queued commands, 18 September 2026

[Scoped host acceptance](queued-commands/README.md#custom-view-host-acceptance) connects the typed SDK queue to real corporate custom views and the development preview. Passed: 491 unit/PostgreSQL tests, strict checks/four fresh builds, four distinct headless journeys and two hidden/unfocused native journeys. Actual offline reload/process restart, exact-key lost replies, declared rejection, accepted-outcome settlement, revocation, duplicate-free record/audit counts, scoped Axe/keyboard/overflow and four inspected captures support the milestone. The evidence records the disclosure and Electron Axe harness corrections. Eight historical captures were restored; no stylesheet changed. Explicit command correction, broader recovery and full parity remain open.


## Saved command correction, 18 September 2026

[Scoped recovery acceptance](command-correction/README.md) verifies offline saved reviews, exact original identities, authoritative cancellation before replacement, explicit never-submitted dependent choices and late acceptance without a new business effect. Passed: 500 unit/PostgreSQL tests across 84 files, strict checks/four fresh builds, six headless browser journeys and five hidden/unfocused native journeys. Real restart/lost-reply paths assert exact records and audit counts. Scoped Axe/keyboard/overflow and five representative captures were inspected. The detailed record separates the final presentation-only status fix from the preceding full unit run and records fixture/screenshot harness corrections. Twelve historical captures were restored; no stylesheet changed. OFF-01, broader recovery, full parity and UI refinement remain open.


## Held command authority, 18 September 2026

[Acceptance record](command-authority/README.md): recovery rechecks access after asynchronous reads/verification and within its final local transaction. Delayed real settlement replies, lease expiry and delivered command revocation preserve exact saved work, hide unauthorized input and permit only subsequent authorized continuation. Passed 502 unit/PostgreSQL tests across 84 files, strict checks/four fresh builds, five headless browser and six hidden/unfocused desktop journeys, scoped Axe/keyboard/overflow and six inspected captures. Twenty historical captures were restored; no UI/style source changed. Original versus installed permissions across upgrades, profile recovery and broader OFF-01/release gates remain open.


## Command upgrades and original permissions, 18 September 2026

[Scoped acceptance](command-upgrade/README.md) verifies original/installed permission checks, retained review contracts, offline denial, explicit review of a new required input field, lost-reply recovery and exact old-release dependent continuation after a compatible upgrade. Final-source verification passed 504 unit/PostgreSQL tests, strict checks/four fresh builds, nine headless browser journeys and eight hidden/unfocused native journeys, with scoped accessibility and six inspected captures. Forty-four historical captures were restored; no stylesheet changed. Fixture corrections and the initial 503/504 run's unexplained concurrent Orders draft server error are recorded. Its focused 18-test rerun and fresh full run passed, without establishing the cause. APP-02, broader OFF-01, full parity and UI refinement remain open.


## Retired command recovery, 18 September 2026

[Scoped OFF-01 acceptance](command-retirement/README.md) verifies read-only recovery after signed command removal/reclassification, original/current grants, offline restart, lost settlement replies, original accepted receipts and cancellations, preserved reviews/graphs and independent resource progress. Strict checks/four builds, 506 unit/PostgreSQL tests, eleven distinct headless browser cases with final expanded retirement reruns and ten hidden/unfocused Electron cases pass. Eight representative captures and scoped Axe/overflow were inspected; historical captures were restored and no stylesheet changed. The evidence records harness repairs and explicit remaining recovery/administration/scheduling gates. Earlier linked-dialog and Orders draft concerns remain open; this does not establish full parity or final UI approval.


## Historical permission administration, 18 September 2026

[Scoped OFF-01/PERM-001 acceptance](historical-permissions/README.md) verifies selected and signed historical declarations shared by the policy editors/server validator, distinct module provenance, source-based filtering, actual role creation/assignment, keyboard revocation/restoration and denied/restored server recovery. Unknown/platform grants, altered artifact bytes and changed trust keys fail. Evidence includes 507 unit/PostgreSQL tests before the final matrix-filter-only UI change, final strict checks/four builds, thirteen distinct headless cases with final affected reruns, eight hidden/unfocused native cases, scoped Axe and eight inspected captures. No stylesheet changed; historical captures were restored. The evidence records corrected accessible-name duplication and harness timing/selector issues. Full parity, final UI refinement and broader recovery/governance/release gates remain open.


## Host-owned command recovery, 18 September 2026

[Scoped OFF-01 acceptance](command-recovery-host/README.md) verifies Settings recovery after custom-view removal and device uninstall, signed offline contracts, current/original command grants, independence from the old view permission, suspension denial, offline restart, lost settlement replies and exact accepted/cancelled outcomes. A still-public independent pending command is never dispatched by recovery; uninstall remains effective. Final product source passed 508 unit/PostgreSQL tests, strict checks/four fresh builds, fourteen headless browser cases and ten hidden/unfocused Electron cases. Scoped Axe/overflow checks and twenty inspected new captures accompany the evidence. Historical captures were restored; no stylesheet changed. Full parity, host-owned resource/draft recovery, export, profile recovery and final UI refinement remain open.


## Host-owned record and draft recovery, 18 September 2026

[Scoped OFF-01 evidence](resource-recovery-host/README.md) verifies original record input, ordinary drafts and accepted/cancelled outcomes after resource removal or device uninstall. Current resource grants, signed original contracts, offline leases, lost replies and restart remain enforced; settlement does not submit corrections or delete drafts. The new surface uses the existing UI components.

Storage/server/model paths passed 510 unit/PostgreSQL tests before the final presentation and routing corrections. Final source passed strict checks/four fresh builds, eighteen headless browser cases, fourteen hidden/unfocused native cases and five additional native uninstall/reconnect repetitions. Twelve captures were inspected and 111 historical captures restored. Diagnostics traced the intermittent missing launcher to a stale startup redirect replacing Settings; the final redirect rechecks the live URL, with ordinary router timing preserved. The detailed evidence records the failed intermediate fix and test import correction. No stylesheet changed. Advanced review/collision acceptance, exports, profile recovery, broader parity and final UI refinement remain open.

Final storage follow-up: the affected 55-test file and strict checks passed after adding a draft-only uninstall case. It verifies retention of both current recovery metadata and the original draft schema without a journal. Product source and completed browser/native acceptance were unchanged.


## Saved-review recovery outside module views, 18 September 2026

[Scoped OFF-01 evidence](host-review-recovery/README.md) verifies independent queued/direct reviews, ordinary drafts, collision-source input and archived input after uninstall and offline restart, followed by explicit reinstall and completion. Original archived bases no longer borrow a later server snapshot. The host preserves request identities, comparison choices and source data, with existing authorization and offline settlement restrictions.

The model/storage/server paths passed 511 unit/PostgreSQL tests across 85 files. Final strict checks and four fresh builds passed; ten headless browser cases passed, followed by the affected collision case after the final wording clarification. Nine hidden/unfocused native cases passed on final source. Twenty captures were inspected with nested comparison disclosures open; scoped Axe/overflow checks and code formatting passed. Historical PNGs were restored, and no stylesheet changed. The linked evidence records fixture failures and capture timing without treating those as product acceptance. Independent exports, remaining schema/legacy combinations, profiles, broader parity and final UI refinement remain open.

## Saved-work architecture checkpoint, 18 September 2026

[Checkpoint and independent review](architecture/README.md#saved-work-checkpoint-review-18-september-2026) preserve unfinished OFF-01 work in `168834e`. Sol xhigh and parent review agree that the existing structure and current recovery ownership need no further architectural change. Nine fixtures and fresh strict checks passed; four build tasks succeeded from valid cached outputs. Historical captures were restored; no product source or UI changed during the audit and no application window was launched. Export acceptance was pending at this checkpoint; the subsequent milestone below records final verification. Full parity remains open.

## Independent saved-work exports, 18 September 2026

[Scoped OFF-01 evidence](work-recovery-export/README.md) verifies actual JSON export of exact requests, drafts, independent comparisons and collision/archive provenance after view removal, uninstall and offline restart. Native authenticated catalog observation and original-contract preparation address metadata loss after policy revision and reauthentication. Delayed save revocation denies file delivery; browser preparation authentication failure locks recovery while retaining work.

Final frozen-source verification passed 514 unit/PostgreSQL tests across 86 files, strict checks/four fresh builds, nine headless browser journeys and ten hidden/unfocused native journeys. Thirty-two captures were inspected, scoped Axe/overflow/keyboard checks passed, changed TypeScript formatting passed and 68 historical captures were restored. No styles changed. The linked record distinguishes intermediate failures from final acceptance and preserves broader scheduling, recovery, profile and release gates. Full parity and final UI refinement remain open.

## Workspace-wide synchronization, 18 September 2026

[Scoped OFF-01 evidence](workspace-synchronization/README.md) verifies one coordinator for automatic synchronization and explicit resource/command retries. Installed-release/dependency verification and original/current policies/grants apply without an open module view. Real browser/native journeys capture in two independent modules, restart offline, reconnect from Settings, recover a lost committed reply, isolate rejection and preserve exact dependencies with duplicate-free records/audits.

Final frozen-source checks passed 523 unit/PostgreSQL tests across 87 files, strict checks/four fresh builds, twelve headless browser journeys and twelve hidden/minimized, unfocused native journeys. Four final captures were inspected; scoped keyboard/Axe regressions, formatting and diff checks passed. Ninety-eight overwritten historical PNGs were restored. No stylesheet or visual component changed. The evidence records outdated pause-by-navigation assertions, fixture readiness/navigation corrections and the final consolidation of explicit retries. Full OFF-01, profile recovery, wider parity and UI refinement remain open.

## Explicit cross-module command continuation, 19 September 2026

[Scoped OFF-01 evidence](command-continuation/README.md) verifies independent modules' selected/unselected commands through offline restart, held settlement and child revocation/regrant, preserving bodies and retry identities with duplicate-free records/audits. Resource-write continuation has signed-contract/storage coverage; complete authoring acceptance remains open. Unavailable selections are retained and normal module capture does not inherit continuation authority.

Verification passed 531 unit/PostgreSQL tests across 88 files, strict checks/four fresh builds and thirteen headless browser journeys with a focused recheck after a reconnect-harness correction. Eleven native regression cases passed in the full run and two focused cases subsequently passed on final product source, hidden/minimized and unfocused. The full native run had a harness failure and a separate intermittent offline export denial; its unchanged passing rerun does not fix **OFF-01-EXPORT**. Ten captures were inspected and 116 historical PNGs restored. No styles changed. Broad recovery, provider/release gates and final UI refinement remain open.


## Synchronization ownership and recovery ordering, 19 September 2026

The requested Sol xhigh [architecture review](architecture/README.md#synchronization-ownership-review-19-september-2026), following checkpoint `546837c`, moved the durable synchronization runner into the client package with a small shared shell policy adapter. Parent review verified unchanged authorization, cancellation and retry behavior. [Native recovery ordering](recovery-metadata-ordering/README.md) resolves OFF-01-EXPORT with a deterministic failing-before/passing-after stale-response reproduction while preserving real denials.

Final source passed 540 unit/PostgreSQL tests across 88 files, strict checks/four fresh builds, three headless browser and five hidden/unfocused native journeys. The recovery fix additionally passed six repeated native cases and fourteen native regressions before the ownership move. Four final synchronization and two recovery captures were inspected; historical captures were restored. Source formatting, diff checks and documentation links passed. Full OFF-01, profile recovery, parity and UI refinement remain open.


## Queued-resource SDK and architecture review, 19 September 2026

[Public queued-resource acceptance](resource-continuation/README.md) verifies typed create/update/archive capture, real bases, exact retries, selected command-to-create continuation, current permission checks and web/native offline restart. The broad run passed 548 unit/PostgreSQL tests, six headless browser and five hidden/unfocused native journeys. All twelve new captures were inspected; existing presentation is preserved without implying final UI approval.

Checkpoint `c43e7de` precedes the requested Sol xhigh [architecture review](architecture/README.md#queued-resource-checkpoint-review-19-september-2026). Parent correction of ambiguous retry identities then passed all 550 unit/PostgreSQL tests. Final schema-ownership corrections passed 41 affected tests including nine architecture fixtures, two headless preview journeys, strict checks and four fresh builds. The linked records distinguish run scopes and the earlier interrupted regression, which supplies no evidence. Broader OFF-01, profile, provider/release and UI-refinement gates remain open.


## Three-release saved-review recovery, 19 September 2026

[OFF-01-SCHEMA acceptance](command-schema-review/README.md) closes a reproduced form dead end: obsolete saved fields were retained but hidden, preventing a valid correction. Shared forms now display those fields with explicit draft-only removal, including nested objects. Original requests and unsaved prior reviews remain intact; explicit saves and final corrections survive real browser/native restarts and retain server authority.

Final-source verification passed 554 unit/PostgreSQL tests across 89 files, strict checks/four fresh builds, eight headless browser and three hidden/minimized native journeys. Scoped Axe/overflow checks passed and eight final captures were inspected. The record distinguishes the initial rollout-version harness correction from the failing product baseline. Broader OFF-01, profile/provider/release and final UI gates remain open.


## Reviewed resource descendants, 19 September 2026

[OFF-01-DESC acceptance](resource-descendants/README.md) fixes original SDK capture retries after reviewed dependency remapping and verifies real command-to-update/archive continuation. Original input, target, base version and identity remain exact; only selected unsent work resumes, under current authority. Recovery exports preserve both original capture and current scheduling prerequisites. Missing legacy history is not reconstructed.

Strict checks and four fresh builds passed. The full regression passed 543 tests; a setup connection timeout prevented 20 integration tests from running, and the exact integration suite subsequently passed all 20. All 563 distinct tests across 89 files therefore passed across two runs. Final acceptance passed five headless browser and five hidden/minimized Electron journeys, with scoped Axe/overflow assertions and eight inspected captures. Production styling is unchanged. Real submitted-child outcomes, other OFF-01 work, profile/provider/release gates and final UI refinement remain open.


## Submitted descendant outcomes and independent progress, 19 September 2026

[OFF-01-OUTCOME acceptance](submitted-descendants/README.md) reproduces and fixes queue starvation after an isolated network/server failure. The SDK now preserves that request's uncertainty while giving unrelated eligible work one attempt; shared authentication, membership/MFA failures and rate limits still stop the pass. Real command/create/update/archive children recover accepted or cancelled outcomes after reviewed parent continuation, lost execution and settlement replies, and offline restart, without changing original identities or duplicating effects/audits.

Final verification passed 567 tests across 89 files, strict checks/four fresh builds, ten headless browser and ten hidden/minimized Electron journeys. Scoped accessibility/overflow checks passed; eight final captures were inspected. The evidence distinguishes an initial dialog-navigation harness failure from the reproduced product failure. Production UI/styling is unchanged. Remaining legacy/collision, working-set, profile/provider/release and full UI gates stay open.


## Archive review and architecture checkpoint, 19 September 2026

[OFF-01-ARCHIVE acceptance](archive-review/README.md) fixes rejected/conflicting archives opening an empty create form. A fresh server snapshot informs explicit replacement only after original settlement; accepted originals recover receipts, cancelled originals preserve their fence through interruption, and already-archived targets resolve the original without another archive. Current authority, exact installed releases, unselected sibling preservation and duplicate-free effects pass real web/native restart and lost-reply journeys.

Verification passed 575 unit/PostgreSQL tests across 89 files, strict checks/four fresh builds, eight headless browser and eight hidden/minimized Electron journeys. Scoped accessibility/overflow checks passed; twelve final captures were inspected. An initial ambiguous fixture selector was corrected to require the exact published release. [The requested Sol xhigh audit and parent review](architecture/README.md#archive-recovery-checkpoint-review-19-september-2026) confirmed package ownership and transaction/lock boundaries with no additional structural change justified. Historical captures were restored. Failed-create archive target reassignment, remaining legacy/profile/release work and full UI refinement remain open.


## Archive collision targets and narrow navigation, 19 September 2026

[OFF-01-COLLISION-ARCHIVE acceptance](collision-archives/README.md) adds explicit target choice for never-submitted archive descendants of a failed create. Parent recovery leaves the archive awaiting a separate review; current server data and authoritative settlement govern the final request. Real SDK/web/native journeys verify both destinations, repeated lost replies and restarts, preserved originals and exactly one archive/audit. Repeated parent collisions also preserve existing-target update/archive reviews. Visual verification reproduced and fixed long labels leaking from closed narrow navigation.

The full 580-test regression passed; the final 70-case focused run includes independent-target and ordered archive-review cases, for 582 distinct tests. The full run preceded the final guard correction, which is covered by the final focused run. Final strict checks and four fresh builds passed. Acceptance covers eight distinct headless browser and seven hidden/minimized native journeys: the four affected archive cases per client were rerun after the final guard correction; the remaining collision cases passed before that guard-only change. Twelve of twenty final captures were inspected, with scoped Axe/overflow and keyboard checks. The linked record distinguishes both failing-before reproductions and the final evidence. Full OFF-01, custom/submitted collision descendants, legacy/profile/release acceptance and final UI refinement remain open.
