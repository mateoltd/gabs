# Imported work across schema and target changes

Scope: source/schema/target reconciliation in **ID-03-BACKUP-CORPORATE**. Status: **verified within the following web/native journeys**. This extends the existing record, collision, reference and snapshot acceptance; it does not replace actual-provider/platform gates.

## Observable behavior

The [shared journey](../../../tests/support/corporate-portability/schema.ts) publishes three signed public-SDK resource definitions through the existing registry review flow. Fixture SQL provisions a new company's entitlement, activation, assignment and ordinary resource permissions. Actual public rollout operations select releases, and the host downloads/verifies/installs them normally. No host source or central module list is changed.

1. Under release 1.0.0, the source creates and exports an actual offline draft containing `name` and `legacy`.
2. Release 1.2.0 removes the resource. An independently authenticated empty destination imports the original file and restores a separate saved review. Its exact data and original signed version remain available; no journal entry or server record is created. The retired resource has no editable tab or resume action.
3. Selecting release 1.1.0 restores the resource with `name` and required `category`. The review exposes the retained obsolete `legacy` value. Explicit keyboard removal and a new category allow one valid server create. The original imported copy and source file remain exact; reload retains the created record.
4. The user exports an unsent edit to that record. The server archives it through the real records API before a third, independently authenticated empty device restores the edit. Restoration reads the current archived target and preserves the intended edit. The editor offers export and no Save action. The actual exported recovery file preserves the original record identity, base version and intended data. Records and record-targeted audits remain unchanged by recovery, with no queued mutation.

The second and third desktop stores use independent controlled OS keys. Browser contexts are independent, not seeded by copying IndexedDB. Only files explicitly exported by the product are transferred. Original schemas remain signed/versioned; retirement does not grant execution against a removed resource.

## Verification, 20 September 2026

- **Two complete final product journeys passed:** headless web and hidden/minimized, unfocused Electron. Both include retired resource, changed fields, archived target and actual final export. `/tmp/gabs-imported-schema-final-product.log`.
- **104 import unit tests passed**, covering the shared authority/retention/promotion paths. `/tmp/gabs-imported-schema-unit.log`.
- Strict root/browser/Node/preload/worker checks passed after the final export assertion. Dependency/copy checks and scoped formatting passed. `/tmp/gabs-imported-schema-final-types.log`, `/tmp/gabs-imported-schema-lint.log`, `/tmp/gabs-imported-schema-format-final.log`.
- All **12 final wide/narrow captures** were inspected; scoped Axe A/AA and horizontal-overflow checks passed. Native tests preserved the default hidden/minimized configuration. Disposable databases and device profiles were removed.

The first test selector matched no tests; its database was removed. The first browser fixture then selected a disabled upload input before the dialog's initial refresh completed. Its trace showed no recovery request. The corrected fixture waits for the actual input to become enabled. The browser case passed, both complete cases then passed, and both passed again after adding the actual archived-input export assertion. These were fixture corrections; no production source, styles or public contracts changed. No fresh product build or full unit/PostgreSQL regression is claimed for this test-only increment.

## Captures and limits

| State | Web | Desktop |
| --- | --- | --- |
| Retired resource retained | [Wide](web-retired.png), [narrow](web-retired-narrow.png) | [Wide](desktop-retired.png), [narrow](desktop-retired-narrow.png) |
| Obsolete field and current schema | [Wide](web-changed.png), [narrow](web-changed-narrow.png) | [Wide](desktop-changed.png), [narrow](desktop-changed-narrow.png) |
| Archived target recovery/export | [Wide](web-archived.png), [narrow](web-archived-narrow.png) | [Wide](desktop-archived.png), [narrow](desktop-archived-narrow.png) |

The existing editor displays the obsolete field twice, with duplicate removal controls. The generic restoration notice also directs the user to a module whose resource may be retired. Both are recorded in the queued UI-refinement inventory. Capture/keyboard evidence establishes these functional paths, not design approval or whole-product accessibility conformance.

Development authentication and native protection are controlled fixtures. Actual OIDC/MFA, physical OS protection/biometrics, signed target releases and reboot/remount/power-loss acceptance remain required. See the [corporate acceptance reconciliation](../corporate-recovery/README.md) for the complete current mapping and next work.
