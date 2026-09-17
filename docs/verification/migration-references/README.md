# Recursive migration reference acceptance

17 September 2026. SDK-04 follow-up to [recursive resource references](../reference-fields/README.md), extending EXT-03 migration authority. Local Node 24.19.0, PostgreSQL 18.6 and macOS arm64.

## Behavior verified

Signed, independently published migration fixtures now verify final-state reference reconciliation through the same authority checks used by ordinary resource writes:

- Nested arrays, maps and union branches enforce active workspace targets, membership and declared cross-module access. A string newly annotated as a reference, a changed target namespace, a historical link copied to another field and an untouched record with changed schema semantics require validation.
- The host compares final records with their original signed contract and data. An intermediate invalid record, or a newly created record subsequently rewritten, cannot establish a historical-link exemption.
- Existing links to archived records survive in top-level fields, nested arrays and union branches. Both initially unversioned and recorded storage-release paths are exercised. An explicit pin to the not-yet-installed target cannot act as the historical contract. Invalid original data receives no historical-link exemption.
- A link to a target created later in the same migration succeeds. Archiving a newly referenced target before completion causes rejection.
- Failures roll back records, revisions and migration progress even if the enclosing caller catches the exception. The temporary baseline table is absent after a caught failure. Existing forced-disconnect, concurrent retry, workspace isolation, compatible pin and private-store uniqueness checks continue to pass.
- Final checks page through more than 100 retained records. The original data remains in PostgreSQL temporary storage rather than an unbounded JavaScript map.

## Real administrator journey

`tests/e2e/module-migration.spec.ts` uses a signed module with nested references through the existing **Modules > Configure** control. A missing nested target produces the actual server error, preserves schema 1 and retains the original record/version. After fixture correction, retry reaches schema 2, preserves its link to an archived record, records exactly one migration and displays the transformed record. An incompatible schema-1 pin remains rejected.

The Chromium test ran headless. Scoped Axe A/AA checks passed. Five new captures were inspected; the existing modal remains usable at wide and 390-pixel widths. This is regression evidence for the existing interface, not UI design approval or whole-product accessibility conformance. Historical migration screenshots were preserved.

- [Before](before.png)
- [Rejected nested link](failure.png)
- [Accepted migration](after.png)
- [Narrow layout](narrow.png)
- [Incompatible executable rejected](incompatible-pin.png)

## Checks

- Full unit/PostgreSQL suite: **189 tests, 39 files**, 86.42 seconds with the final production code.
- Expanded migration/reference/business cases: **34 tests, four files**, 9.40 seconds. The initialized-storage fixture and subsequent explicit-pin guard also passed independently.
- Private-store and local-migration regressions: **13 tests, two files**, 1.81 seconds.
- Headless administrator journey: **one passed**, 23.3 seconds including server setup, after waiting for observable client installation readiness.
- Strict TypeScript, boundary/copy checks and all four production builds passed. Final repository formatting and local documentation links passed.

Logs: `/tmp/gabs-migration-full-final.log`, `/tmp/gabs-migration-test.log`, `/tmp/gabs-migration-focused.log`, `/tmp/gabs-migration-initialized.log`, `/tmp/gabs-migration-regressions.log`, `/tmp/gabs-migration-build-final.log`, `/tmp/gabs-migration-browser-accepted.log`.

An intermediate browser rerun reached the migrated schema but opened the module while its client update was still downloading/installing; the five-second record assertion saw “Loading workspace.” The trace showed the pending artifact/report/platform requests. The journey now waits for displayed installed versions before migration and before opening the updated view, matching the existing lifecycle acceptance pattern. The final run passed; no load/performance target changed.

## Limits

This milestone covers public resource references. Private-store and operation-input annotation semantics remain open. Historical identity is scoped to the original record, field path and target namespace/UUID. Moving a link, including changing its array position, requires validation against an active target. A recorded schema-producing contract is the authority for historical annotations; data invalid under that contract is revalidated without exemption. Schema-changing reference semantics require a reviewed migration.

This is one atomic transaction, with PostgreSQL temporary disk/storage overhead and the existing migration timeout constraints. It is not resumable partial migration progress. No native migration journey, hosted migration, provider authentication, production release, load or restore exercise was run for this change. SDK-04 and overall parity remain incomplete.
