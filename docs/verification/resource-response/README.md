# SDK-04: validated resource-client results

17 September 2026. Public SDK response validation is implemented; generated host/journal integration and full SDK-04 acceptance remain open.

## Behavior

- Public record/page schemas derive returned data validation from the declared resource schema. Every resource-client get/list/create/update/archive result is checked before typed success. Required envelope metadata is validated, future envelope fields remain compatible and declared resource-data constraints remain enforced.
- Invalid results raise `INVALID_RESOURCE_RESPONSE`. Mutation failures retain the original idempotency key and explicitly preserve uncertainty about whether the request committed. There is no automatic retry. `isResourceResponseError` supports structural narrowing across independent bundles.
- Cancellation wins over malformed late reads. Transport errors retain their existing behavior. Provisional envelopes cannot masquerade as confirmed records. Standalone receipts and record versions remain intact.
- New custom views require resource-client revision 3. The host advertises explicit support for revisions 1/2/3; older hosts lacking revision 3 reject new views before module initialization.
- See [authoring and recovery semantics](../../module-resource-responses.md). UI layout and styles were not changed.

## Verification

- Formatting and all 594 checked local documentation links passed. Strict types, dependency/copy checks and all four production builds passed. The final guard/copy build is `/tmp/gabs-resource-response-build-final2.log`.
- **231 unit/PostgreSQL tests across 49 files passed in 54.99 seconds**, using a temporary migrated/seeded database (`/tmp/gabs-resource-response-full2.log`). The final additive cross-bundle error guard and revised copy also passed **14 focused tests in 1.87 seconds** (`/tmp/gabs-resource-response-unit-final2.log`).
- Negative cases cover malformed data and metadata on every resource method, malformed pages/cursors, provisional results, single transport dispatch, preserved keys/errors and aborted late responses. A standalone adapter exercises valid create/retry/list/update/get/archive with three retained receipts and correct versions.
- **Eleven distinct headless browser journeys passed across correction runs.** Ten form/map/table/sort/query cases passed in the broader run (`/tmp/gabs-resource-response-browser.log`). The corrected compatibility case passed in 14.1 seconds (`/tmp/gabs-resource-response-browser-recovery.log`). Both final query/capture cases passed again in 14.3 seconds after the user-facing copy revision (`/tmp/gabs-resource-response-browser-copy.log`). All used temporary databases.
- The authoritative recovery case deliberately corrupts a successful create response, observes SDK rejection, retries with the same key and verifies exactly **one record and one create audit entry**. A real HTTP list response with malformed data clears the custom table, exposes an error and returns to valid records after explicit retry. Existing permission, cursor, cancellation, offline and schema-editor checks continue to pass.
- **One hidden/unfocused Electron journey passed in 8.2 seconds** (`/tmp/gabs-resource-response-native.log`), exercising the signed server query, public resource controls and renderer isolation with minimized/hidden and unfocused assertions at both ends.
- Final [wide error](invalid-read.png) and [390-pixel error](invalid-read-narrow.png) captures were inspected; the document has no horizontal overflow. Error copy was simplified after inspection, keeping technical identity in diagnostic fields. Historical regression captures were restored. Temporary databases were removed; shared development data and existing preview services were preserved.

## Corrections found

The first full run exposed two unhandled rejections from intentionally detached denied writes. The derived validation promise is now drained without changing its rejection for callers or the authoritative host's transaction rollback tracking. The final full suite passed without unhandled errors.

The compatibility test previously sampled its download counter before the asynchronous update began. It now waits for download activity and the completed update attempt, preserving assertions that the incompatible package cannot replace the installed release.

## Remaining acceptance

`packages/app-web/src/module-view.tsx` still sends requests directly, casts live get/list responses and consumes cached pages outside the public resource client. Its save/journal acknowledgment path also needs validation before treating a result as accepted. `syncModuleStorage` may submit entries from several modules and retained versions, so validating everything against the currently displayed module would be incorrect.

Next: apply shared schemas using each request's appropriate signed module/resource/version contract, reject malformed live/cache results, retain uncertain mutation keys and avoid accepting invalid journal results. Preserve original-version and cross-module queue behavior. The [SDK-04 map](../../sdk-04-acceptance.md) remains active until this is verified. Broader offline, UI-kit, performance, signing, provider and release requirements retain their original tracker rows. Actions budget and artifact quota remain external remote-acceptance dependencies.
