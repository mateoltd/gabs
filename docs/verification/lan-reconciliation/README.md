# Remote prerequisites and original-release recovery

Status: locally verified, 18 September 2026. Scope: SDK-05-LAN-RECON, not full SDK-05 or release parity.

## Behavior and authority

- A bounded read-only receipt lookup acknowledges committed module requests for the current account/workspace. Current membership, module availability, assignment and resource read/write or public operation permission are required. Unknown, inaccessible and non-module keys are indistinguishable. The endpoint returns no response payloads and invokes no handlers or new business effects.
- Received drafts resolve prerequisites from protected local outcomes or these server acknowledgements. Missing prerequisites preserve the draft and allow unrelated work. Remote acknowledgements never masquerade as locally verified content/outcome records.
- The review displays the original module release. Recovery obtains and verifies that exact retained signed contract, validates queued policy and input/output schemas, and sends the original version and retry key. The desktop request boundary permits this endpoint's bounded version query while rejecting malformed versions and unrelated query usage.
- Downloading a retained contract grants no execution rights. The existing administrator rollout policy can permit compatible original releases; schema/backend/dependency compatibility and current business permissions still apply. Mandatory updates block new old-version effects. No automatic data conversion or retry-key replacement occurs.
- An exact already-committed request can recover its authoritative result after a mandatory update, including after loss of the original successful reply and process restart. Current account/module/operation access is still required. A peer/file cannot assert acceptance.

## Executed verification

| Check | Result and evidence |
| --- | --- |
| Focused recovery/authority/rollout | 43/43 passed across four files before the native query-boundary correction. `/tmp/gabs-receipt-recon-tests3.log`. |
| Final full unit/PostgreSQL suite | 400/400 passed across 74 files, including the corrected desktop query validator, scoped receipt lookup and rollout/idempotency regressions. `/tmp/gabs-receipt-recon-full.log`. |
| Strict checks/builds | Root and browser/Node/preload/worker TypeScript, boundary/copy checks and all four production builds passed. `/tmp/gabs-receipt-recon-build2.log`. Existing web chunk-size warning remains. |
| API generation | OpenAPI and client declarations regenerated from the real API using a migrated/seeded disposable database. `/tmp/gabs-receipt-recon-api.log`. |
| New hidden native journey | Passed remote same-account prerequisite acceptance, missing prerequisite rejection, explicit compatible old-release permission, lost reply, mandatory update, process restart, exact receipt recovery and unrelated current-release progress. `/tmp/gabs-receipt-recon-native2.log`. |
| Headless browser controls | 2/2 passed: keyboard selection/dismissal, narrow layout, dialog controls, tooltips and save feedback. `/tmp/gabs-receipt-recon-browser.log`. |
| Existing hidden native journeys | Employee offline/archive/file/expiry/revocation recovery and administrator review/capacity/restart both passed. `/tmp/gabs-receipt-recon-regressions.log`. |

The new native journey uses a separate authenticated server session to commit a prerequisite absent from the receiving device's journal. It publishes two independently signed and reviewed fixture versions, permits the older version through the real rollout API, loses one successful write reply, makes the update mandatory, and restarts Electron before retrying. Database assertions verify exactly four records/audit entries and one receipt for the uncertain original request. A separate unconfirmed old-version draft remains blocked; unrelated current-version work succeeds.

The first native run exposed a real missing connection: the desktop operation validator rejected the new retained-contract endpoint's version query before submission. A narrowly scoped allowance fixed it; valid/invalid version coverage, the full suite and the final native journeys pass. No server authority or acceptance check was bypassed. An earlier focused integration fixture incorrectly assumed the active Inventory version was 1.1.0; it now obtains the active version for new writes and uses 1.1.0 only to test historical retrieval.

Scoped Axe and overflow assertions passed. Inspected [wide](release.png) and [390-pixel](narrow.png) captures show the original-release explanation and recovery actions without clipping. Layout/styles were preserved; this is continuity evidence, not final design approval. Historical screenshots from regression journeys were restored to their committed bytes.

All Electron windows remained hidden/minimized and unfocused. The new journey uses real TLS transport, protected persistence, signed packages, PostgreSQL and server effects. Regression file dialogs are controlled to avoid foreground interaction. Each runner created and removed only its own disposable database; shared previews and user data were preserved.

## Remaining scope

Explicit sign-out/profile-removal recovery remains OFF-03/identity work. Original drafts that cannot execute under any supported compatible release remain reviewable/exportable; no universal conversion is promised. Multi-host certificate deployment, partition/platform acceptance, production identity providers, actual OS notification presentation and signed installed-package acceptance retain their separate gates. OFF-01 is the next independent engineering item. Full parity and the later UI-refinement goal remain open.
