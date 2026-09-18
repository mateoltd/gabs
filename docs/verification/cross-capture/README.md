# Nested cross-module offline capture

OFF-01, 18 September 2026. This extends [dependent capture](../offline-dependencies/README.md), [journaled collision recovery](../create-collisions/README.md) and [structured conflict review](../structured-conflicts/README.md).

## Behavior and corrections

The generated client captures declared references inside arrays, keyed tuples and active union branches. Repeated references to the same pending parent create one prerequisite edge. Cross-module choices require a previously authorized lookup; current server grants are checked again on submission. Connected grant denial clears downloaded labels while preserving the selected identifier and other input.

This acceptance exposed two defects:

- An empty Select could open a zero-height popup that intercepted clicks. Empty or disabled controls now close their popup and show an explicit loading/empty state. Restoring choices re-enables the control without reopening it or discarding input. Search and retry controls remain separate.
- A reviewed replacement can be newer than its waiting descendants. The journal now processes newly unblocked work in the same synchronization pass. Each request is attempted at most once per pass; acceptance is persisted before releasing dependents, and authority is checked before each dispatch. Missing, cyclic, rejected or uncertain prerequisites remain blocked. Independent ready work can proceed without a global chronological ordering guarantee.

No stylesheet or application layout changes were made.

## Actual interface journey

The same journey runs in headless Chromium and hidden, unfocused Electron:

1. Publish a signed test module through the SDK with nested Contacts references and its own dependent comments. Create an isolated company workspace. Without a cross-module grant, a pending Contact is not offered as an offline choice.
2. Grant reference access through the platform API. Remove all choices while the picker is open, confirm it closes, and restore access without losing editor input.
3. Offline, capture a Contact, a dependent record referencing it in an array, an escaped map key (`a/b~c`) containing a tuple, and a union branch; capture a comment referencing that record and an unrelated Project.
4. Reload the browser or restart the native process while offline. Revoke the cross-module grant, reconnect, and lose the first successful parent response. The original parent key is retried exactly; the dependent is rejected, its comment waits, and the unrelated Project succeeds.
5. Review the rejection, verify downloaded labels are removed and stay unavailable offline, restore the grant and submit a replacement. Its dependent comment resumes in the same pass with the rewritten prerequisite.
6. Capture another offline chain and occupy its parent identifier through the authoritative API. Explicit separate-record recovery creates a new parent identity and atomically remaps every eligible nested link and dependent request. Existing authoritative data and child record identifiers remain intact.

PostgreSQL assertions verify all nine resulting records, exact nested references, versions and nine corresponding create audits. They distinguish accepted effects from UI pending/rejected states.

## Verification

- Strict root and browser/Node/preload/worker checks, boundary/copy checks and all four production builds passed: `/tmp/gabs-cross-build-accepted.log`.
- Full unit/PostgreSQL regression passed 445 tests across 79 files: `/tmp/gabs-cross-full.log`. New scheduler cases cover newer prerequisites, duplicate dependency IDs, missing/cyclic prerequisites, malformed responses and authority loss between dispatches.
- Nine headless browser journeys passed: the new cross-module journey (`/tmp/gabs-cross-web-8.log`) and eight affected existing journeys (`/tmp/gabs-cross-web-regressions.log`) covering controls, schema forms, maps/tuples, references, dependencies and collisions.
- Four hidden/minimized, unfocused native journeys passed: the new cross-module journey (`/tmp/gabs-cross-native.log`) and dependency, collision and reference regressions (`/tmp/gabs-cross-native-regressions.log`).

Product source remained frozen during the serialized acceptance runs. The new journeys verify actual PostgreSQL state and audits, not only success messages.

## Visual evidence

[Web pending choices](web-picker.png), [web narrow revoked review](web-revoked-narrow.png), [web recovered records](web-recovered.png). [Native pending choices](native-picker.png), [native narrow revoked review](native-revoked-narrow.png), [native recovered records](native-recovered.png). All six captures were inspected. Long generated forms scroll inside the existing dialog; narrow content fits without horizontal overflow. Native captures use physical device pixels. Scoped dialog Axe checks passed on both clients.

## Scope limits

The fixture uses real signed publication and runtime execution, with activation/assignment provisioned directly in the isolated database. It does not establish hosted registry trust, installation-commerce acceptance, full fifth-module acceptance, final UI approval or whole-product accessibility conformance.

Early test drafts were corrected to use the separate Settings link, add the required array item, select the active union format and wait for asynchronous controls. An authorized empty lookup is a valid prior-grant marker; it need not already contain a just-queued parent. These fixture corrections were separate from the two production defects above.

Same-record ordering, ambiguous drafts, archived-input/custom-operation recovery, permanent revocation, direct process/sign-out/profile recovery and the remaining [offline workflow gates](../../offline-workflows.md) remain required. OFF-01 and full parity stay open.
