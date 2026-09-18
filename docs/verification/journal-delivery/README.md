# Durable journal delivery through later denial

18 September 2026. Scoped progress under OFF-01; full offline recovery and parity remain open.

## Implemented behavior

The SDK journal persists an uncertain dispatch marker and increments the attempt count **before** transport. If that durable write fails, no request is sent. A crash after a server effect but before local acknowledgement therefore retains the original key and uncertainty. New entries from the host and developer simulator explicitly start unsubmitted. Legacy entries without delivery metadata are treated as uncertain even when their old attempt count is zero, because earlier transport failures were not counted.

An ambiguous attempt remains pending through later permission, version or other request denials. Its error explains that the earlier outcome is unknown; the existing Review control cannot create a replacement. Dependent requests wait, while unrelated work continues after an individual denial. Timeouts, throttling, server errors and authentication failures persist uncertainty before stopping the batch. Malformed acknowledgements also preserve the original identity. Ordinary definitive first-attempt rejections/conflicts remain reviewable.

Successful retry still requires current server authorization and the retained original response contract. It clears uncertainty only after a verified response. The authoritative idempotency receipt prevents another business effect or audit entry. No permission check was relaxed and no server/API/schema migration was introduced.

## Verification

| Check | Actual result |
| --- | --- |
| Initial focused SDK/simulator/storage checks | 26/26 passed before the additional timeout cases. `/tmp/gabs-journal-delivery-unit.log`. |
| Full isolated unit/PostgreSQL suite | 413/413 passed across 76 files. Includes dispatch persistence failure, interrupted result persistence, lost reply followed by denial, independent progress, legacy zero-attempt uncertainty, malformed replies and HTTP 408/429/500/401. `/tmp/gabs-journal-delivery-full.log`. |
| Strict checks and builds | Root and four environment TypeScript checks, dependency/copy checks and all four production bundles passed. Existing chunk-size warnings remain. `/tmp/gabs-journal-delivery-build.log`. Final root/environment checks also pass after test refinements: `/tmp/gabs-journal-delivery-types-final.log`. |
| Browser acceptance/regressions | 6/6 passed: new delivery journey, both conflict-review variants, both malformed-response cases, and dependent drafts. `/tmp/gabs-journal-delivery-browser-final.log`. |
| Hidden native acceptance/regressions | 3/3 passed: new delivery journey, conflict-review restart and dependent-draft restart. `/tmp/gabs-journal-delivery-native.log`. |
| Final focused capture/message checks | Both affected browser and hidden-native journeys passed again with the explicit role-denial assertion and complete-panel captures. `/tmp/gabs-journal-delivery-browser-capture.log`, `/tmp/gabs-journal-delivery-native-capture.log`. |

The shared browser/native journey queues a contact, its dependent note and an independent project. It allows the real server to commit the contact, revokes its write permission in the isolated fixture database, then drops the reply. A real retry receives the current permission denial. The original entry stays pending, the dependent note waits, and the unrelated project commits. Browser reload or full Electron restart/reauthentication preserves that state. Restoring permission recovers the original receipt and permits the note. PostgreSQL has exactly three business records and one create audit each, with the same three journal keys and no replacements.

The first browser run reached restart successfully but failed because the test selected both the Contacts navigation link and its current-page breadcrumb. The test now targets Main navigation explicitly; product behavior was unchanged. Subsequent browser/native runs also frame the complete pending panel and assert the actual role-denial message.

## Interface and scope

Scoped Axe and 390-pixel overflow checks pass. [Browser](web-pending.png) and [native](native-pending.png) captures show the existing pending panel and disabled review action. No product style, layout or theme changed. These captures establish scoped readable recovery feedback, not final UI approval or whole-product accessibility conformance. Browser execution was headless; native windows were hidden/minimized and unfocused. No OS dialog or notification opened. Each integration runner migrated/seeded and removed its own database; shared development servers were preserved.

## Required follow-up

The [OFF-01 map](../../offline-workflows.md) still requires authoritative settlement for uncertain requests that **never committed**. A missing receipt or later denial is insufficient to allow a new key while another attempt could still commit. Such entries deliberately remain pending today. Permanent revocation, direct online editor recovery, received relay envelopes, independently saved review drafts, failed-create/rejected-parent correction, same-record ordering, nested references and queued custom operations retain their separate gates. No original requirement is deferred or marked complete by this milestone.
