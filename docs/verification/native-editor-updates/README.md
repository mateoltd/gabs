# Generated native editor handoff

16 September 2026. EXT-05 acceptance continuation.

Two real Electron journeys now exercise the generated editor while mandatory releases change its schema. Both use isolated company/profile fixtures, independently signed and reviewed releases, the native IPC bridge and the authoritative PostgreSQL-backed API.

## Verified behavior

- A failed artifact download leaves the open editor and all entered fields intact. Once downloading succeeds, the same editor retains its record ID, base version and unsaved input. Removed fields remain available until explicitly removed; new required fields can be completed before saving.
- An accepted update whose HTTP reply is lost remains explicitly unconfirmed. After mandatory schema replacement, its fields stay locked and retry uses the exact original request key/body/release. The server returns the committed result with one record update, one audit and one receipt.
- Both paths export the original input through the real bounded native recovery export. The file identifies unsaved versus unconfirmed work; uncertain exports include the original request. The OS save chooser is substituted with a temporary test destination, and the actual IPC validation and disk write execute.
- Removing the resource entirely disables saving while preserving and exporting input. Closing that recovery dialog returns to the remaining resource.

[Preserved editor](preserved.png), [uncertain request](uncertain.png), [removed resource](removed-resource.png). All three native states were visually inspected. The long uncertain-state dialog scrolls to its retry action; existing native transport error details remain visible and are not a claim of finished UI polish.

## Checks and limits

Both new minimized/unfocused Electron journeys passed. The two browser journeys also passed after extracting their shared reviewed release fixture. Strict TypeScript, boundary/copy and formatting checks passed. The preceding implementation milestone passed all nine earlier native journeys, 79 unit/PostgreSQL tests and four builds; this test-only addition brings distinct native coverage to eleven, without claiming a fresh all-eleven suite run or rebuild.

Transport failure injection affects only the native HTTP boundary; UI state, installer, export and server execution remain real. Fixture grants do not verify administrator journeys. This proves live-editor handoff, not crash persistence, signed installed-runtime acceptance on every OS, or recovery after profile removal/revocation. Fleet rollout progress, partial failures and connected suspension delivery remain EXT-05 work. The parity goal remains active; final UI refinement remains a separate queued goal.
