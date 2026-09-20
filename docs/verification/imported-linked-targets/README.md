# Imported linked record targets

Scope: **ID-03-BACKUP-LINKED-TARGETS**, within ID-03-BACKUP-CORPORATE. This scoped child is verified; the corporate recovery parent remains active.

## Behavior

A linked update draft may have been reviewed against a different record after a create collision. Import previously refused that review. Restoration now requires a fresh original/reassigned target choice, settles the exact original request with the server, reads the selected current record and recomputes field conflicts. A stopped request keeps its original identity, call and prerequisite lists. Only the explicit new destination becomes local review metadata; file-supplied approval and reference remappings remain inert.

Accepted requests cannot be retargeted: a reassigned selection is refused, and choosing the original restores an independent review of the actual accepted record. Unknown, unrelated or broader reference remappings still require their own graph recovery. Fields inherited from a saved target snapshot are not treated as fresh edits when the original request was already accepted. Archived records keep their input for recovery, and their base version comes only from a snapshot or original call belonging to that record. Current authorization is checked after target reads and before the atomic local commit.

Accepted resource requests that are prerequisites of unfinished scoped work are now visible in Settings recovery and can be exported. Unrelated historical accepted work stays outside that list. A receipt imported from a file is verified with the server before it satisfies a dependency. A restored linked review cannot submit a correction while its prerequisites are missing. Raw source files and retained copies remain unchanged.

## Acceptance

The new product journey creates a contact collision, captures a dependent edit offline, explicitly reassigns it to a separate record and saves its review through the normal UI. Settings exports the actual linked draft and accepted prerequisite. Both corporate records then advance. A fresh independent device imports the child first, chooses its target again and remains held until the parent receipt is imported and verified. After reload, fresh field review updates exactly the selected record; the other record remains unchanged. The original stopped request remains fenced against late retries.

Browser and hidden/minimized native tests exercise original and reassigned selections. Native OS protection and development authentication use controlled fixtures; these are not actual OS-provider or live identity-provider claims. Final verification and capture review are recorded below.

## Remaining scope

Request-only update/archive target restoration, other mixed-reference recovery graphs, multiple conflicting import snapshots, broader source/authority/failure transitions, encrypted corporate archives, corporate key loss and actual provider/platform acceptance remain under the parent tracker. This child does not establish full parity or final UI approval.

## Review and intermediate verification

The initial focused run exposed a test fixture carrying an explicit `undefined` operation field that disappears during JSON export; the fixture now represents the actual resource-call shape. Test selectors were corrected to identify the exact accepted receipt rather than also matching its dependent's prerequisite text. The importer uses sections rather than list items, and file selection now waits for the existing refresh to finish before choosing a second file. These were fixture corrections; the original behavioral assertions remain intact.

Before the final accepted-snapshot/provenance refinement, 140 focused tests, strict environment/boundary/copy checks, four fresh builds and 894 isolated regression tests across 121 files passed. Eleven browser/cross-surface and seven hidden/minimized native journeys also passed. These are intermediate results, not evidence for subsequent source changes. Browser wide/narrow captures were inspected; duplicated confirmation copy was removed using the existing components so actions remain visible without style changes.

The review added failing cases for inherited accepted values and archived-record version attribution (`/tmp/gabs-linked-target-review-red.log`). The first behavior could invent a conflict or reapply an unchanged historical value; the second could label an original record with the reassigned record's version. The final implementation preserves the saved comparison base and selects provenance by record identity. All 145 focused cases pass after those corrections (`/tmp/gabs-linked-target-final-focused.log`). Final broad acceptance is recorded below.

## Final verification

- Focused import/storage tests: **145 passed**, `/tmp/gabs-linked-target-final-focused.log`.
- Strict root/browser/Node/preload/worker types, boundary/copy checks and **four fresh builds passed**, `/tmp/gabs-linked-target-final-build.log`.
- Isolated unit/PostgreSQL regression: **899 tests across 121 files passed**, `/tmp/gabs-linked-target-final-regression.log`.
- Headless browser/cross-surface acceptance: **11 journeys passed**, `/tmp/gabs-linked-target-verified-web.log`.
- Hidden/minimized native acceptance: **seven journeys passed**, `/tmp/gabs-linked-target-verified-native.log`.

These 18 journeys include both new linked-target choices on each platform plus independent collision drafts, ordinary imports and four-direction file portability. All eight final captures were inspected. Keyboard selection/reset, reload, scoped Axe A/AA and 390px overflow checks passed; dialog actions remain visible and readable using the existing design system. No CSS changed. This is scoped continuity evidence, not whole-product accessibility conformance or final UI approval. All disposable databases were removed; the fixtures clean up their independent device profiles. Native OS protection remains a controlled provider.

| Platform and selection | Wide | Narrow |
| --- | --- | --- |
| Web original | [Capture](web-original-choice.png) | [Capture](web-original-narrow.png) |
| Web reassigned | [Capture](web-reassigned-choice.png) | [Capture](web-reassigned-narrow.png) |
| Native original | [Capture](native-original-choice.png) | [Capture](native-original-narrow.png) |
| Native reassigned | [Capture](native-reassigned-choice.png) | [Capture](native-reassigned-narrow.png) |
