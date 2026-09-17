# Public reference client acceptance

17 September 2026. SDK-04 follow-up to [recursive reference fields](../reference-fields/README.md). Node 24.19.0, PostgreSQL 18.6 and macOS arm64.

## Implemented and observed

- The public SDK resource client exposes validated `.references(query, { signal })` and a `.loadReferences` callback accepted directly by typed forms and filters. Resource names, bounded query values and result shapes have compile-time coverage; declared schema pointers and returned pages also receive runtime validation. No application-facing request body cast is needed by the fixture view.
- Corporate adapters use the existing versioned GET endpoint. Independent installed web/Electron views and scoped read-only server operations receive the same lookup. Source and target permissions, dependencies, grants and current workspace authority remain enforced by the server.
- The shared loader rejects undeclared targets and cancellation before transport, propagates abort signals and discards aborted responses. Lookup is read-only in the SDK, simulator, scoped operation context and local worker; it creates no journal entry, receipt or local profile commit.
- Standalone generated forms resolve active records from their own installed module in the current unlocked profile. Missing membership directories, cross-module targets and corporate-only target resources fail explicitly. Browser acceptance creates a target and linked note while offline, without adding another corporate record.
- Development fixtures supply members and explicit provider read grants. Inactive members/accounts and archived targets are excluded. Preview controls demonstrate denied lookup, granting access, searching a provider, server-query lookup, permission revocation and grant revocation. Loading a provider alone does not grant access.
- Signed independent client/server packages import the public reference helpers. The fixture builds, publishes, stages, installs and saves its chosen UUID through the public client without changing host routing or catalogs. Its scoped server query resolves the same selected label.

## Verification

| Check                                                                                 | Result                                   |
| ------------------------------------------------------------------------------------- | ---------------------------------------- |
| Full unit/PostgreSQL suite                                                            | 194 tests in 40 files, 87.70 seconds     |
| Final cancellation/reference/local-worker pass                                        | 11 tests in three files, 741 ms          |
| Strict TypeScript, boundary/copy checks, four production builds                       | Passed                                   |
| Headless development reference and service-preview journeys                           | Two passed, 18.1 seconds including setup |
| Final headless custom-client, generated-reference and development regression journeys | Three passed, one minute including setup |
| Hidden/unfocused Electron custom-client and generated-reference journeys              | Two passed, 30.4 seconds including setup |
| Scoped Axe A/AA on installed custom view                                              | No violations in tested state            |
| New web, narrow standalone, development and Electron captures                         | Inspected                                |

The full suite preceded the final adjustment making an already-aborted bound loader reject asynchronously. The final focused pass and subsequent builds/browser/native journeys include that adjustment. Browser and native suites ran serially; native assertions check that windows remain hidden/minimized and unfocused. Historical regression captures were restored.

The independent fixture tests 105 targets, paging past the first page, literal search, retaining a selected off-page label, actual server query execution, saving the correct UUID and retrying an unavailable lookup. Local worker acceptance checks unchanged snapshots/receipts and cross-scope denial. Unit/SQL tests also check response validation, current target permissions, active member filtering, explicit grants, aborts and workspace-scoped API transport.

- [Installed web module](web.png)
- [Standalone narrow form](local-narrow.png)
- [Development grant denial](development-denial.png)
- [Hidden Electron module](electron.png)

Logs: `/tmp/gabs-client-refs-full.log`, `/tmp/gabs-client-refs-cancellation.log`, `/tmp/gabs-client-refs-final-build.log`, `/tmp/gabs-client-refs-dev-browser.log`, `/tmp/gabs-client-refs-regressions.log`, `/tmp/gabs-client-refs-native.log`.

An initial independent-package run exposed a missing server-bundle import allowance for the public reference subpath; the ABI now supplies the same host helpers and the real package journey passes. A fixture initially omitted its custom navigation view; that fixture was corrected before acceptance. No production route or permission check was bypassed to make the journey pass.

## Limits

Corporate independent views require an online lookup; the generated host's leased label cache is not automatically supplied to arbitrary custom views. Standalone support here covers same-module generated forms, not cross-module local brokers or custom standalone view mounting. Simulator and local resource writes still validate schemas without the corporate reference-integrity checks; lookup acceptance does not close that gap.

Tuple/map picker editors, nested/off-page table labels, richer query controls and complete SDK composition remain open. Operation-input/private-store annotations do not acquire resource-reference semantics. Development in-memory checks do not prove PostgreSQL concurrency or production authority. The captures are regression evidence, not final UI approval or whole-product accessibility conformance.

No new hosted provider, signed production release, load or restore exercise was performed for these SDK changes. Prior checkpoint `7401f8d` passed 189 unit and 85 browser tests plus all three unsigned packaging jobs and logical restore in CI; its unchanged load gate failed at 891/1,821 ms. OPS-07, SDK-04 and overall parity remain open.
