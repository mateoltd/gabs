# Imported independent collision drafts

Scope: **ID-03-BACKUP-COLLISION-DRAFTS**, within ID-03-BACKUP-CORPORATE. This scoped child is verified; the corporate recovery parent remains active.

## Behavior and boundaries

A saved collision draft can contain the original record snapshot alongside an explicitly reassigned destination. The previous import path dropped the collision context and could restore reassigned input against the old target. It now requires a fresh **Original draft before reassignment** or **Reassigned draft** choice. There is no default, and leaving confirmation clears the choice.

Restoration reads the selected record under current account/workspace authority, compares the selected input against current server values and creates a separate saved review. Disjoint changes merge; conflicting fields need new choices. The selected historical schema version is retained. An archived target keeps its input and archived state; a missing or unverifiable target, revoked access, lock or cancellation prevents restoration without deleting the imported copy. A missing reassigned target identity cannot silently turn an edit into a create.

The raw imported envelope retains the exact original data, snapshots and copied choices. The promotion receipt records the user's new source selection. The restored independent draft contains fresh comparison/target state; copied collision metadata never becomes a live journal prerequisite or approval. It does not settle or recreate a related request named in the file. Existing linked-request collision/dependency guards remain unchanged. Copies with linked request reassignment still require their broader graph recovery workflow.

The client owns choice validation, current-target preparation and atomic storage through the existing import path. The shell uses the existing field, select, disclosure and dialog components. No stylesheet or package structure changed.

## Product journey

The source creates a contact offline. Another authenticated session creates that identity first, producing a real create collision on reconnect. The source then saves an ordinary draft against that corporate record and explicitly assigns the draft to a separate record during collision recovery. Settings exports the actual draft before its target review is resumed: its saved snapshot still points to the original record, while its reassigned target points to the newly created one.

Both records advance on the server. A new independently authenticated device receives only the exact UI-exported file. Confirmation initially has no source selection; selecting and leaving confirmation resets it. Keyboard selection chooses a source, and restoration survives a renderer reload. The module editor shows the chosen record's current name and email, requires a fresh phone-conflict choice, and updates that record exactly once. The other record and source bytes stay unchanged; the original cancelled create remains fenced against late retries.

Both original/reassigned choices run on headless web and hidden/minimized Electron. Native stores use independent controlled OS-protection keys and actual main/IPC/utility SQLite paths, with controlled save-dialog selection. These are not actual OS-provider, live MFA, signed platform or physical-device claims.

## Verification

- Focused saved-work import tests: **45 passed**, `/tmp/gabs-collision-import-final-unit.log`.
- Strict environment types, boundary/copy checks and four fresh builds passed: `/tmp/gabs-collision-import-final-build.log`.
- Final isolated regression: **888 tests across 121 files passed**, `/tmp/gabs-collision-import-regression.log`.
- Final headless web/cross-surface acceptance: **nine journeys passed**, `/tmp/gabs-collision-import-final-web.log`.
- Final hidden/minimized native acceptance: **five journeys passed**, `/tmp/gabs-collision-import-final-native.log`.
- All disposable databases were removed. The device fixtures clean up their independent profiles.

The product suites include both new original/reassigned collision journeys on each platform plus existing import and file-portability regressions. All eight final captures below were visually inspected. Keyboard selection, scoped Axe A/AA checks and 390px overflow checks passed. Existing components remain readable with reachable actions and local focus treatment. This scoped evidence is not whole-product accessibility conformance or approval of the overall UI.

| Platform and choice | Wide | Narrow |
| --- | --- | --- |
| Web original | [Capture](web-original-choice.png) | [Capture](web-original-narrow.png) |
| Web reassigned | [Capture](web-reassigned-choice.png) | [Capture](web-reassigned-narrow.png) |
| Native original | [Capture](native-original-choice.png) | [Capture](native-original-narrow.png) |
| Native reassigned | [Capture](native-reassigned-choice.png) | [Capture](native-reassigned-narrow.png) |

The first build caught test-fixture type errors and use of `onChange` instead of the host select's typed `onValueChange`; those were corrected. The first product run exposed a live-prerequisite coupling when restoring reassignment metadata, plus a fixture read that raced queued server acceptance. Restoration now retains metadata only in the inert copy and explicitly creates an independent review; the fixture waits for authoritative version advancement. Original behavioral assertions remain intact.

## Remaining requirements

Linked record reassignment and mixed request graphs, multiple imported snapshots, broader contract/target transitions, delayed identity/failure/process-death acceptance, encrypted corporate archives and corporate key loss remain under ID-03-BACKUP-CORPORATE. Overall parity and UI refinement remain open.
