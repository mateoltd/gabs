# Device rollout visibility

16 September 2026. EXT-05 continuation; parity remains active.

## Implementation

Module administrators can open **View devices** from an existing module card. The dialog shows the selected and accepted releases, known-device totals, server-confirmed installations, the most recent recorded attempt per person/device, failure categories and server receipt/report times. It paginates 50 devices at a time and refreshes explicitly or every 30 seconds. Narrow layouts stack device details without horizontal clipping.

Device observations are separate from authoritative installation receipts. The authenticated server supplies the actor/workspace; reports cannot assign modules, grant permission or create an accepted installation. A ready report requires the exact current receipt for that user, device, module and release. Reports have bounded schemas and failure categories; raw error messages are not uploaded. Per-attempt sequence checks ignore duplicates and out-of-order phases. Later reports for an already-recorded older attempt do not displace a newer recorded attempt.

The installer retains its latest report in account/workspace-scoped module storage and retries undelivered reports when connected. Local commit failure remains visible even after the server accepted the installation. Successful recovery updates the report without duplicating the installation audit. Installing an unchanged dependency preserves its original receipt time instead of making its existing readiness observation appear stale.

Reports describe observations, not current connectivity or current authorization. A disconnected or compromised client cannot finalize corporate actions by claiming to be ready. Devices that have never attempted installation are not counted. Already-issued offline leases retain their explicit expiry limits.

## Regression corrections

The larger run exposed workspace creation assigning every dynamically registered module. Provisioning now defaults to the generated, immutable bundled-module selection; additional selections are explicit trusted onboarding input. Registry discovery alone no longer activates or assigns a new module. Production onboarding still leaves entitlements inactive and activations in draft. Existing business data and installations are not rewritten.

A completed member save also left unrelated dialogs locked while queries refreshed. Mutation completion now releases the interaction lock independently of background refresh. The full suite also caught a text locator hidden by the mobile column label; the status now has its own text element without weakening its assertion.

## Verification

All 81 unit/PostgreSQL tests and four production builds passed. API acceptance checks forged actor fields, invalid failure codes, forged readiness receipts, revocation, nonadministrator reads, cross-workspace isolation, duplicate/out-of-order phases, delayed updates to recorded older attempts, and a 52-device paginated dataset. Type checks reject unknown phases and failure codes. Lifecycle tests cover interrupted download, uncertain server acceptance, failed local commits, reconnect delivery and one installation audit through recovery. Onboarding checks prove catalog discovery does not assign an optional module by default.

The full headless Chromium selection passed 63/66. Its three failures exposed the onboarding assignment leak, the completed-mutation interaction lock and the status text element issue described above. All 11 affected browser journeys passed after the corrections, including the three originally failing journeys. Thus 66 distinct browser journeys passed across candidate iterations; this is not a fresh all-66 pass after the last correction.

The new two-device browser journey interrupts one real download, shows one server-confirmed installation and one failed device, resumes the failed installation and verifies both devices ready. The dialog had zero detected Axe WCAG A/AA violations. Wide/narrow partial-failure and recovered screens were inspected; narrow device details do not overflow horizontally. [Partial failure](partial-failure.png), [narrow layout](narrow.png), [recovered devices](recovered.png).

All 11 real Electron journeys passed with minimized, unfocused windows. Both generated-editor journeys open the new device view through the bounded IPC and verify the matching readiness receipt. The [native device view](electron.png) was inspected. Formatting passed. These checks do not establish signed installed-runtime acceptance on every operating system.

## Remaining work

Connected suspension delivery and emergency/offline acceptance remain EXT-05 work. Progress reports currently cover attempts after a release plan exists; preflight dependency/configuration failure reporting, removal-attempt reporting and delivery/backoff policy need additional work. Reports first received only after a long disconnection are ordered by server receipt time, not a claim of a globally coordinated client clock. These observations are not hardware attestation or a guarantee that a disconnected device has erased data. Signed installed-runtime acceptance on all supported operating systems remains OPS-04; the separately queued UI-refinement goal is unchanged.
