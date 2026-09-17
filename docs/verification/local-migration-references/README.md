# Standalone migration reference reconciliation

17 September 2026. SDK-04 follow-up to [ordinary local/simulated reference validation](../reference-integrity/README.md). Node 24.19.0, PostgreSQL 18.6 and macOS arm64.

## Implemented behavior

- Local installation validates final annotated references in every retained record, including archived rows, after all migration steps complete. New targets created later in the transaction can satisfy earlier writes. A newly referenced target archived before completion cannot.
- The profile host supplies the previous installed release. The worker verifies its signed artifact or matches the official bundled definition before using its contract. A different module, incompatible source schema or source declaring a newer schema cannot establish historical evidence.
- Historical identity includes the original resource, record ID, field data path, target namespace and case-insensitive UUID. Unchanged links to archived targets survive. Copying links to another record/position, adding annotations, changing targets or moving the source resource requires fresh validation.
- Original data invalid under the source schema gets no exemption. Neither a newly created row nor an intermediate invalid/repaired write can create historical evidence. Missing source evidence causes full final-reference validation.
- The complete result commits through the existing encrypted profile installation transaction. Failure retains the previous records, selected release, schema and retry receipts. Compatible reinstallations/rollbacks also validate retained references; no migration history is fabricated for a no-step installation.

## Evidence

- **206 unit/PostgreSQL tests in 42 files passed**, 87.39 seconds.
- **21 focused tests in four files passed**, 799 ms. These cover historical archival, copied references, changed annotations/targets, invalid source data, intermediate writes, final target availability, archived source rows, 105 retained records, compatible no-step checks and source schema mismatch, alongside existing migration/worker/ordinary-write regressions.
- Strict TypeScript, dependency/copy checks and all four production builds passed.
- Two initial headless browser journeys passed in 32 seconds including setup: the new signed migration flow and the existing retained-version/offline rollback journey. The final migration-only rerun passed in 16.1 seconds, including setup, with reduced motion and a closed-menu capture.
- One minimized/unfocused native package journey passed in 19 seconds including setup. It exercises the packaged worker under native CSP, coordinated local upgrades, restart recovery and historical receipts. This is native installation regression evidence; the new invalid-reference/tampered-source scenarios run in the browser worker journey.
- Both new browser captures were inspected. Historical native/browser regression captures were restored. No production UI layout or styling was changed.

The signed browser fixture is built, reviewed and published as three immutable releases. Its initial local operation creates a linked note and archives the target. The test then corrupts only the historical package sent to the worker and observes checksum rejection. With genuine source bytes, an invalid migration is separately rejected. Exported profile data proves the old release, records and receipts remain unchanged. A corrected release preserves the historical link, records exactly one migration, and survives lock/unlock with the new schema.

- [Rejected new link](rejected.png)
- [Recovered historical note](recovered.png)

Tests: `tests/local-migration-references.test.ts`, `tests/e2e/local-migration-references.spec.ts`, plus existing `tests/local-migrations.test.ts`, `tests/e2e/local-versions.spec.ts` and local worker/integrity tests.

Logs: `/tmp/gabs-local-migration-refs-tests.log`, `/tmp/gabs-local-migration-refs-full.log`, `/tmp/gabs-local-migration-refs-build.log`, `/tmp/gabs-local-migration-refs-browser.log`, `/tmp/gabs-local-migration-refs-browser-final.log`, `/tmp/gabs-local-migration-refs-native.log`.

## Limits

Pure SDK migration callers must supply an already verified source contract if they need historical-link preservation; the optional argument alone does not verify a signature. The real profile worker performs that verification. Historical identity does not follow resource renames or array-position changes automatically.

This is whole-snapshot, atomic local migration, not incremental migration persistence. Historical-reference sets consume worker memory in addition to the existing private snapshot. Corporate imports, cross-module local capabilities, operation-input/private-store annotation semantics, native database encryption and trust-key rotation remain separate work. No new hosted provider, production release, load or restore acceptance is claimed. SDK-04, broader parity and final UI approval remain open.
