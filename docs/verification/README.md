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
