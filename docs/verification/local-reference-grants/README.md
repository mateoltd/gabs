# SDK-05: standalone reference grants

17 September 2026. Cross-module standalone reference reads have local acceptance. SDK-05 remains active for device capabilities, local services, installation-time migration grants and the other [acceptance requirements](../../sdk-05-acceptance.md).

## Behavior

- The local profile owner opens **Manage local modules → Reference access** to allow a declared consumer to read a specific standalone provider resource. Access defaults to denied and requires a compatible declared dependency plus the provider's declared resource read permission.
- Consent is encrypted with the profile and bound to both exact module versions. Updating either release requires renewed consent. Removing either module clears the grant while preserving business records and historical receipts.
- The host supplies only granted resource snapshots from the same profile. The worker verifies each provider's signed package or bundled contract before resolving references. Foreign records are read-only and never merged into the consumer's saved state. Archived targets cannot be selected or used for new links.
- Profile revision checks before worker dispatch and before accepting its result reject stale or removed profiles. Another window's revocation requires a fresh unlock before further requests; this does not promise immediate clearing of already displayed text in every window.
- The checkbox reports the durable saved decision. Lock/unlock retains consent, and revocation invalidates the current reference loader. This uses the existing host controls and layout; scoped visual checks are not final UI approval.

## Verification

- Strict TypeScript, dependency/copy checks and all four production bundles passed (`/tmp/gabs-local-grants-build-final2.log`).
- **243 unit/PostgreSQL tests across 53 files passed in 64.20 seconds** on a fresh migrated/seeded temporary database (`/tmp/gabs-local-grants-full.log`). Three new tests cover target validation, profile/dependency/resource boundaries and exact-version grant eligibility. The earlier focused set passed 19 tests across four files.
- **13 headless browser journeys passed in 2.0 minutes** (`/tmp/gabs-local-grants-browser-final.log`). They cover the new offline consent journey, actual isolated workers, signed provider/consumer updates, invalid provider signatures/contracts, competing-window revocation, profile isolation, lock recovery and existing installation/dependency/migration/retained-version controls.
- The independently signed provider and consumer install through public contracts without host registration. Either update denies reads until new consent; removing and reinstalling the consumer retains its saved linked record while requiring consent again.
- **Four hidden/unfocused Electron journeys passed in 37.6 seconds** (`/tmp/gabs-local-grants-native.log`): new reference consent, local controls, signed package recovery and encrypted worker restart. The new journey asserts windows remain hidden or minimized and unfocused before and after interaction. No real save dialogs or OS notification presentation were invoked.
- The new web journey completes grant, lock/unlock, linked-project creation and revocation while offline. The final denied picker exposes no contact option. Scoped Axe found no violations. Inspected [wide](wide.png), [390-pixel](narrow.png) and [native](native.png) captures; the narrow document has no horizontal overflow. Historical captures were restored and temporary databases removed.

During test authoring, required contact/project values, nested picker dismissal and asynchronous controlled-checkbox interaction needed fixture corrections. The final runs above passed after those corrections; the production behavior was not weakened.

## Limits

This grants standalone reference reads, not arbitrary cross-module services, writes or device effects. Corporate operations still require corporate authority. Reviewed module code is trusted application code; worker isolation is not a hostile-publisher sandbox.

The migration validator can accept scoped reference providers, but installation does not yet review prospective grants for migrations introducing new foreign links. Existing unchanged links retain the historical-contract reconciliation rules. Installation-time grant review, local service transactions, local host capability consent/brokering, corporate offline capability leases, native LAN acceptance and full parity remain open. No production deployment, billing or external messages were performed.

Source checkpoint `7429b7bb127b322b41b29541b798c55fb576a402` / [CI 35208850942](https://github.com/mateoltd/gabs/actions/runs/35208850942) started no jobs. All four ended with zero steps; check `105161193657` reports: “The job was not started because an Actions budget is preventing further use.” Local acceptance above passed; remote acceptance requires restored account capacity.
