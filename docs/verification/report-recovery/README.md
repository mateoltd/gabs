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
