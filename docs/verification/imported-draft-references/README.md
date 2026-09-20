# Imported draft reference context

Scope: **ID-03-BACKUP-DRAFT-REFERENCES**, under ID-03-BACKUP-CORPORATE. Scoped acceptance passed on 20 September 2026.

## Behavior

Restored drafts retain deduplicated reference observations without rewriting saved fields, original calls or prerequisite identities. A linked update's saved target reassignment also supplies an informational hint when its fields may reference that record. Choosing which record to edit does not choose the values of its reference fields. Contradictory observations fail before original settlement, and existing local reviews stay protected.

Stopped linked originals remain fenced and wait for accepted prerequisite receipts before correction. An accepted original can produce a separate draft review of its actual current record; it gains no new executable journal hint context. Independent edits fetch their current record and rebuild conflicts without copied conflict approvals. Archived targets retain the source version information needed for recovery. The immutable imported file preserves the original provenance. Hints participate in existing review-equality and prerequisite guards; they do not prove that any field references either record.

## Product acceptance

The fixture publishes a real SDK module with a self-reference field. Offline capture creates a collision and dependent update; source recovery creates a separate record and a saved update draft. Settings exports the actual draft and accepted prerequisite files. A fresh browser or independently keyed native store receives only those files and authenticates again.

Two cases deliberately cross the choices: edit the original record while referencing the separate record, and edit the separate record while referencing the original. The journey checks fresh target selection, current conflicts, a hold before prerequisite receipt restoration, saved reference hints, explicit field choice, renderer reload, one selected-record effect, unchanged other records, exact retries, fenced originals and unchanged source files.

Native protection and development authentication are controlled fixtures. No real provider/MFA or signed platform acceptance is claimed. No styles changed.

## Verification

- Focused import tests: **83 passed**, `/tmp/gabs-draft-references-unit.log`.
- Strict environment, boundary and copy checks plus **four fresh builds passed**, `/tmp/gabs-draft-references-build.log`.
- Full regression: **927 tests across 121 files passed**, `/tmp/gabs-draft-references-regression.log`.
- **15 headless browser journeys passed**: two new cases in `/tmp/gabs-draft-references-web.log` and 13 surrounding cases in `/tmp/gabs-draft-references-web-regression.log`.
- **15 hidden/minimized native journeys passed**: 12 draft/reference/target cases in `/tmp/gabs-draft-references-native.log` and three collision/import cases in `/tmp/gabs-draft-references-native-regression.log`.
- All disposable databases and temporary profiles were removed.
- All 16 new wide/narrow captures were inspected. Scoped Axe and 390px overflow checks passed.
- Against committed checkpoint `beb2078`, a requested Sol xhigh read-only review found no blocking correctness or ownership defect. Parent review checked the original-input preservation and current-target comparison paths.

Initial browser fixture failures involved an import-specific close helper and ambiguous Review buttons. The next run exposed absent hint metadata on ordinary collision children, which legitimately carry only `recordRecovery`. The implementation now derives the informational observation from that retained target provenance; a dedicated test verifies it without altering source input. Final new browser/native journeys passed after that correction. No business assertion was removed.

## Captures

| Surface | Original target, separate reference | Separate target, original reference |
| --- | --- | --- |
| Browser import | [Wide](web-update-original.png), [narrow](web-update-original-narrow.png) | [Wide](web-update-reassigned.png), [narrow](web-update-reassigned-narrow.png) |
| Browser correction | [Wide](web-update-original-review.png), [narrow](web-update-original-review-narrow.png) | [Wide](web-update-reassigned-review.png), [narrow](web-update-reassigned-review-narrow.png) |
| Desktop import | [Wide](native-update-original.png), [narrow](native-update-original-narrow.png) | [Wide](native-update-reassigned.png), [narrow](native-update-reassigned-narrow.png) |
| Desktop correction | [Wide](native-update-original-review.png), [narrow](native-update-original-review-narrow.png) | [Wide](native-update-reassigned-review.png), [narrow](native-update-reassigned-review-narrow.png) |

The captures show scrolled dialog content; controls outside the capture remain reachable by scrolling. These scoped checks are not overall UI approval or full accessibility conformance.

## Remaining scope

Independent hinted drafts and accepted-original hints have unit coverage; the new end-to-end cases exercise stopped linked update drafts. Multiple-snapshot reconciliation, broader mixed graphs and source/authority/failure transitions, encrypted corporate archives, corporate key loss and actual provider/platform acceptance remain required. Overall parity and later UI refinement remain open.
