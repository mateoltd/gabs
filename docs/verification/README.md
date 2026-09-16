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
