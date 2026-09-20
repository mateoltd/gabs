# Imported record reviews

Scope: **ID-03-BACKUP-REVIEWS**, linked create/update drafts within **ID-03-BACKUP-CORPORATE**. This extends ordinary file portability and preserves the distinction between correcting a stopped request and editing an already accepted record. Advanced reassignment/continuation graphs remain required.

## Behavior

A saved review exported with its original resource request retains that request's identity. Before settlement, import checks the original record target, rejects missing provenance and refuses to overwrite an existing local review or a newer local correction. Reassigned record/dependency contexts are retained in the imported copy and reported explicitly; their choices are not applied implicitly.

After fresh authentication, current permissions and signed-contract validation, the exact original request is settled by the authoritative server:

- **Cancelled original:** a create/update review uses the existing journal-review key and original request identifier. Normal correction submission preserves the record target and supersedes that original. It cannot become an unrelated ordinary draft.
- **Accepted original:** saved edits become a separate review of the accepted record, using its authoritative result identity. An accepted create does not become another create.

For record edits, restoration fetches and validates the current server record. The exported review's target snapshot is the comparison base, so fields merely inherited from that snapshot are not treated as new user edits. The accepted-original path uses the server's original accepted result as its base. Disjoint changes merge; conflicting fields require fresh explicit choices. Copied conflict choices are not automatically applied. Archived records retain their saved input and archived target, so existing recovery controls prevent a write.

Current authority is checked after the record read and again before the atomic local commit. Lost responses, invalid current records and received denial retain the imported copy for retry. No new business effect is submitted by import. Ordinary drafts remain independently stored. The client owns preparation under `packages/client/src/recovery/import/draft.ts`; existing module review and enqueue controls own correction submission. The shell adds explanatory text using existing components. The record editor supplies its opener to the modal before asynchronous loading disables that button, so closing the editor can restore keyboard focus. No style changes are made.

## Verification scope

The real product journey starts with a fixture-provisioned contact and company workspace. The source edits offline, receives a real server conflict, selects a conflict value and saves another field in its review. Settings exports that actual linked review. The server record advances again. A fresh independently authenticated destination imports the exact file, restores the original stopped request and opens **Resume review** from that pending request. Its untouched email reflects the latest server value, its added address is retained, and its conflicting name requires a fresh choice. Saving updates the original record exactly once, clears the pending correction and leaves the old request permanently cancelled. Escape closes the review and restores focus to its opener; Enter reopens it with input and unresolved conflicts intact. The exported bytes stay unchanged.

The ordinary portability cases run alongside this workflow to check that unlinked drafts and requests still recover correctly. Browser contexts are headless. Electron uses the actual main/IPC/utility storage with an independently keyed controlled OS provider; all windows remain hidden/minimized and unfocused. Native save-dialog selection is controlled, and no production bypass is introduced.

Unit checks additionally cover accepted creates becoming edits, local-review collisions, missing originals, reassigned provenance, malformed current-target identity, permission denial after the target read, preserved archived input and cancelled-create identity. The real API/PostgreSQL accepted-create case verifies one existing record, current target data and no extra create during promotion. Actual-provider and physical-device claims are excluded.

## Verification, 20 September 2026

- Full isolated unit/PostgreSQL regression: **859 tests across 121 files**, `/tmp/gabs-linked-review-regression.log`. Includes seven real API import cases. This preceded the final provenance-preservation and keyboard-focus corrections.
- Final import unit checks after preserving original review provenance: **29 passed**, `/tmp/gabs-linked-review-unit.log`.
- Strict root/browser/Node/preload/worker type checks, boundary/copy checks and **four fresh builds** passed after the keyboard correction: `/tmp/gabs-linked-review-focus-build.log`.
- Final headless browser and cross-surface suite: **6 passed**, `/tmp/gabs-linked-review-final-web.log`.
- Final hidden/minimized native-to-native suite: **2 passed**, `/tmp/gabs-linked-review-final-desktop.log`.

The eight product cases comprise ordinary and linked-review workflows in all four source/destination directions. Linked-review cases verify Escape focus restoration, Enter resumption, retained form values, fresh conflict choices, exact record correction and original-request fencing. Scoped dialog Axe A/AA checks report no violations; 390-pixel layouts have no root horizontal overflow. Electron uses the existing single-window Axe compatibility mode. Disposable databases and device profiles were removed.

The initial keyboard check exposed a real defect: disabling the opener during asynchronous draft loading lost its focus identity. The record editor now passes an explicit opener reference to the shared modal; other modal callers retain existing behavior. The final journeys retain the focus assertion. Initial wide captures caught the opening transition, so final screenshots finish animations without changing production styles.

All final wide and narrow captures were inspected. Conflict comparisons remain readable, fields stay within the dialog and the Save action is reachable through its scroll area:

| Source to destination | Wide review | Narrow actions |
| --- | --- | --- |
| Browser to browser | [Review](web-to-web-review.png) | [Actions](web-to-web-narrow.png) |
| Browser to desktop | [Review](web-to-desktop-review.png) | [Actions](web-to-desktop-narrow.png) |
| Desktop to browser | [Review](desktop-to-web-review.png) | [Actions](desktop-to-web-narrow.png) |
| Desktop to desktop | [Review](desktop-to-desktop-review.png) | [Actions](desktop-to-desktop-narrow.png) |

This is scoped continuity and keyboard evidence, not whole-product accessibility conformance or UI-polish approval. No CSS changed, and no live-provider or new signed release-package acceptance is claimed.

## Remaining work

- [Imported stopped command dependencies](../imported-command-dependencies/README.md) now have explicit fresh-selection product acceptance. Imported collision/reassignment and broader mixed recovery graphs still require preserving and revalidating all referenced originals rather than trusting copied mappings.
- Multiple imported snapshots of the same existing review with explicit reconciliation; current promotion preserves existing work and refuses an overwrite.
- Removed/changed resource contracts and broader schema/target transitions through real interfaces.
- Delayed denial/profile/expiry/process-death cases, encrypted bulk corporate backups and unreadable existing corporate-store recovery.
- Live identity MFA, actual OS providers, signed target-platform and physical-device acceptance.

No whole original requirement or overall parity is complete. UI continuity evidence is not approval of the interface as polished.
