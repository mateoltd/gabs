# Durable lifecycle report recovery

16 September 2026. EXT-05 continuation; overall parity remains active.

## Behavior

Reports are delivered in bounded batches of four, with a two-second request deadline in browser and desktop transports. The delivery loop also bounds transports that cannot cancel an in-flight request. A scoped Web Lock serializes delivery across tabs. Failed delivery retains an exponential delay in account/workspace storage, from one second to five minutes; a later phase retains the outstanding delay. Authentication failures remain recoverable after sign-in. Invalid or superseded reports stop retrying without being labeled delivered. Late replies cannot settle a newer observation.

Preflight failures now report without inventing a release version or creating an installation receipt. Repeated failures of the same preflight reuse their observation identity. This includes an authoritative release-plan failure during platform refresh and a local dependency-plan failure. Uninstallation reports awaiting confirmation, failure and completion. A completion report requires the current removal receipt for the same account, workspace, module and device. Reports remain observations: they cannot grant access or create authoritative installation/removal records. Optional account binding rejects a stale delivery made after switching to a different signed-in account; legacy clients remain compatible.

The existing device dialog distinguishes failed installation, failed removal and reported removal. Server-accepted releases remain separate from client progress. No executable update, pending operation or business data is deleted by reporting failure. Database migration 020 preserves existing report rows and defaults legacy actions to installation.

## Verification

- All 85 unit/PostgreSQL tests passed, including durable backoff across a fresh client, later-phase delay retention, authentication recovery, hung/late transport replies, independent delivery, four-report batching, terminal rejection and replacement protection.
- PostgreSQL API checks reject account mismatch, nonexistent modules, forged removal receipts and invalid action/phase pairs. An unknown-version preflight remains observable without an installation. The real lifecycle integration covers repeated failed preflight, rejected dependency removal, lost removal reply and matching recovered receipt, while preserving drafts and exactly one removal audit. That test passed again after the final preflight identity refinement.
- Strict TypeScript, dependency/copy checks and all four production builds passed.
- Six headless Chromium journeys passed: partial installation failure/recovery, dependency-blocked removal followed by accepted removal, uncertain installation recovery with data-preserving uninstall, and all four generated/custom editor update journeys. The device dialog had zero detected Axe WCAG A/AA violations and no horizontal clipping at 390px. [Removal failure](removal-failure.png), [confirmed removal](removed.png) and [narrow layout](removed-narrow.png) were inspected.

- All 11 real Electron journeys passed with minimized, unfocused windows. Generated editor recovery opens the device dialog through native IPC and verifies receipt-matched readiness. The [native device view](electron.png) was inspected. These runs do not establish signed installed-runtime acceptance across operating systems.
- Formatting passed.

## Limits and next work

Connected suspension delivery and emergency/offline acceptance remain EXT-05 work. Reports first received after disconnection are ordered by server receipt time; they are not hardware attestation, proof of present connectivity or proof of local erasure. Reports retain the latest observation per module locally, so an unavailable reporting endpoint may miss intermediate phases. Backoff is persistent, but a report can only be delivered while an authorized client runs. Storage/OS operations themselves are not covered by the network deadline. The later UI-refinement goal and signed installed-runtime acceptance on all supported platforms remain separate.

## 17 September 2026: bounded background lifecycle retries

Remote `a7a346c` / [CI 35154833179](https://github.com/mateoltd/gabs/actions/runs/35154833179) exposed repeated automatic download retries, not stale report ordering. Its trace shows the same attempt moving from failed sequence 2 to downloading 3, failed 4, downloading 5 and failed 6 in under two seconds. The device dialog legitimately sampled the intermediate downloading observation.

Durable transient installation/removal failures now store a background retry count/deadline. Automatic retries wait 30 seconds, doubling to a five-minute cap; the lifecycle lock checks the saved deadline before making requests. Explicit user resume bypasses the delay and retains the request identity. Canceled UI effects do not accrue delay. Skipped background removals do not invalidate the catalog as though a change succeeded. Reporting delivery backoff remains separate.

Verification on this candidate:

- The real PostgreSQL lifecycle integration passes with added assertions for no requests/reports during the saved delay, unchanged request IDs, an expired deadline allowing another automatic attempt, increasing delay after another failure, deferred removal and immediate explicit recovery.
- Strict types, boundary/copy checks and all four builds pass.
- Two headless Chromium journeys pass: the exact fleet failure/recovery journey now includes reloading the failed device before examining its report, and the uncertain-receipt/data-preserving-uninstall journey still passes. Existing business/receipt/accessibility assertions were retained.
- One actual Electron installation-recovery journey passes through a full process restart with one accepted receipt. The existing minimized-test configuration keeps the window hidden/minimized, unfocused and out of the Dock.
- Generated historical captures were restored because no layout changed. Changed-file formatting and whitespace checks pass. Logs use `/tmp/gabs-install-backoff-{types,tests,build,browser,native}.log`.

The remote candidate must still pass fresh CI. This is a scoped lifecycle regression correction, not completion of OPS-07 load or whole-product release acceptance. Preflight failures without a durable attempt retain their existing behavior; background recovery requires a running authorized client.
