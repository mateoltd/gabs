# SDK-05: installation-time reference consent

17 September 2026. Installation-time reference grant implementation and verification. SDK-05 remains active for device capability brokering, local services/atomic business mutations and the remaining [acceptance map](../../sdk-05-acceptance.md).

## Behavior

- The installer previews reference choices against the complete proposed module set. Consent names the consumer, provider, resource and both exact releases; it defaults to unchecked for new access. Package verification, declared compatible dependencies, standalone resource eligibility and provider read declarations remain mandatory.
- `LocalInstallOptions.referenceGrants` is snapshotted on entry. Invalid versions, resources, unrelated modules, duplicate grants and oversized lists reject before an installation attempt is saved. A pending attempt binds its choices to its immutable release/configuration set.
- The encrypted pending attempt stores consent separately from effective grants. All grants, executable releases, schema versions and migrated records commit together only after every module succeeds. Provider migrations run before consumer validation; final references can point to records created by a provider in that same update.
- Cancellation or failure preserves the installed records, releases, receipts and effective grants. Lock/unlock recovery retries the saved choices and revalidates authority. A completed attempt does not replay. Discard cancels pending consent; explicit reference revocation also removes matching consent from unfinished attempts, preventing retry from regranting it.
- The recovery screen shows module names, exact versions and resource titles for saved approvals. The existing grant screen remains the authority for installed reference access. Corporate roles and data are not involved.

## Verification

- Strict TypeScript, dependency/copy checks and four production bundles passed (`/tmp/gabs-migration-grants-build2.log`). Two unchanged bundles reused their build cache.
- **244 unit/PostgreSQL tests across 53 files passed in 72.01 seconds** on a temporary migrated/seeded database (`/tmp/gabs-migration-grants-full.log`). The new planning test verifies that proposed versions resolve together without changing current profile data or granting access.
- Initial focused browser verification passed both new journeys (`/tmp/gabs-migration-grants-browser2.log`, 34.4 seconds). The worker proof rejects forged/duplicate decisions, interrupts a coordinated migration, verifies unchanged old data/grants, unlocks and retries successfully, preserves exactly two original receipts, and prevents a revoked pending grant from being reinstated. The final broader run passed **14 headless browser journeys in 2.5 minutes** (`/tmp/gabs-migration-grants-browser-final.log`), including installation controls, dependency sets, reference grants, migration reconciliation, retained versions and every existing local worker proof. **Four hidden/unfocused native journeys passed in 56.5 seconds** (`/tmp/gabs-migration-grants-native.log`): the new migration consent/recovery flow, existing grant revocation, signed package recovery and local controls.

The final UI journey also cancels a consented installation after a worker starts, verifies pending module names/versions and the preserved old installation, locks/unlocks and resumes. Both module upgrades and the new linked target then appear. Scoped Axe found no violations. Inspected [wide](wide.png) and [390-pixel](narrow.png) captures of the scrolled consent section; the narrow document has no horizontal overflow.

The final source and test files also passed strict TypeScript and boundary/copy checks (`/tmp/gabs-migration-grants-finalcheck.log`). The final hidden native capture rerun passed in 18.8 seconds (`/tmp/gabs-migration-grants-native-final2.log`). Inspected the [native result](native.png), including the preserved note and resolved new target. The test asserts the resource selector is collapsed and uses screenshot animation completion. An intermediate capture-only assertion requiring the closed listbox to be removed from the DOM failed; that is not the control’s visibility contract. No production control or animation was changed.

The first UI test reached a correct linked record but expected a label from a fixture's `text` field. Reference labels use `name` or `title`; the fixture was corrected to supply a name. No production label fallback was changed.

## Limits

Reference snapshots support validation and read-only links, not arbitrary local services, cross-module business mutations or device capabilities. This remains an atomic whole-snapshot migration; it does not implement incremental migration storage, corporate import, full desktop database encryption or trust-key rotation. Reviewed code remains trusted application code. The feature-parity and later UI refinement goals remain separate; scoped captures are not final UI approval.

All browser runs stayed headless and native windows hidden/minimized and unfocused. Temporary databases and native profiles were removed, historical regression captures restored and shared development services/data preserved. No live billing, deployment or external messages were performed. Remote CI capacity remains a separate dependency.
