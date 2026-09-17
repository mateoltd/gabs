# SDK-05: signed corporate host capabilities

17 September 2026. The corporate online milestone passed local acceptance. **SDK-05 remains active** in its [acceptance map](../../sdk-05-acceptance.md); whole-platform parity and final UI approval remain open.

## Behavior

- Independently published modules declare typed export, notification and LAN capabilities with module-owned permissions. Signed metadata, runtime schemas, generated references and host revision requirements derive from those declarations.
- Every corporate effect requests current server authority for the exact actor/workspace/module/version/alias. The endpoint applies current module authorization, selected release and effective permissions; declarations alone do not grant access.
- Web exports report that a download was offered. A late authorization response after view navigation cannot initiate a download. Desktop exports write only to a user-selected path after a second authorization check; revoked permission or an abandoned view prevents the write.
- Native module sessions bind the profile and release and are cleared on view/document/authentication transitions. Inputs/results are validated, and IPC errors are presented without internal channel names.
- LAN status exposes only the active scoped transport. Discovery now returns the actual relay peer identifier, correcting an adapter mismatch found in review. LAN receipt remains explicitly non-authoritative.

## Verification

- Strict TypeScript, dependency/copy checks and all four builds passed (`/tmp/gabs-capabilities-build-final2.log`).
- **238 unit/PostgreSQL tests across 51 files passed in 55.99 seconds** (`/tmp/gabs-capabilities-full.log`) on a temporary migrated/seeded database. This includes inferred negative contracts, exact signed capability metadata, revoked/closed/switched/mismatched native contexts and existing corporate business checks. Subsequent changes were the stale-view lifetime guard, fixture presentation and the peer-ID correction; those received the focused and interface verification below.
- **11 focused tests across three files passed** after the final peer-ID correction (`/tmp/gabs-capabilities-guards-final.log`). The real mutual-TLS transport test relays using an ID returned by discovery, checks second-port fallback and rejects a foreign workspace. Both Node and browser signature verification reject a correctly signed but mismatched capability manifest.
- **Nine headless browser journeys passed in 1.7 minutes** (`/tmp/gabs-capabilities-browser-final.log`). The new journey builds/reviews/publishes a fifth fixture through the CLI without host edits, checks version/permission/foreign-workspace/suspension denial, downloads exact content, and proves revocation and late authorization cause no new download. Existing compatibility, editor-update, preview and public resource-query regressions pass.
- **Five hidden/unfocused Electron journeys passed in 21.1 seconds** (`/tmp/gabs-capabilities-native-final.log`). The new journey executes the independent module through real API/IPC, checks disabled LAN state, verifies the notification presentation request, writes an accepted export, then proves revocation during a held save dialog and navigation prevent later files. Completion signals wait for the actual host promise before asserting no effect. Existing resource-query and three restart/update/receipt journeys pass.
- Native tests replace only save-dialog selection and notification presentation, avoiding foreground dialogs and OS notification HUDs. They assert hidden/minimized and unfocused windows before/after. The file write, module host sessions and authoritative API run normally. This does not verify a person interacting with a real OS dialog or seeing a notification.
- Inspected [wide error](revoked-web.png), [390-pixel error](revoked-narrow.png) and [native error](revoked-native.png). Errors wrap, actions stay separated and the narrow page has no horizontal document overflow. Fixture status no longer retains a prior success after failure. Shared shell styling was preserved; this is scoped functional review, not UI refinement acceptance.

Historical regression screenshots are preserved. Temporary databases/profiles are removed; existing development data and preview services remain available. No production publishing, live provider effects or external messages were performed.

## Remaining work

See the [SDK-05 map](../../sdk-05-acceptance.md) for standalone/offline grants, local cross-module services/references, capability simulation, official adapter migration and administrator grant review. Positive native module LAN relay/receipt, persistent notification delivery, broader profile recovery and hosted release acceptance remain open. Review/code containment does not sandbox hostile publishers or protect against a compromised OS.

GitHub Actions budget and artifact quota remain separate remote-acceptance dependencies; local passes do not establish executed release CI acceptance.
