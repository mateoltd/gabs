# SDK-04: signed host UI compatibility

17 September 2026. This is scoped framework/lifecycle acceptance. SDK-04, full platform parity and final UI approval remain open.

## Behavior

- Builders derive named contract revisions from emitted host value imports, including aliases and reexports. Type-only imports do not add requirements. Namespace/default React, dynamic and literal CommonJS imports conservatively require the namespace's complete public export set. JSX and view/resource context requirements are explicit.
- Requirements travel in each executable bundle and the signed manifest. Both cryptographic verifiers and registry review require exact metadata correspondence. Existing bundle formats, host/backend version ranges, storage compatibility, signatures and permission checks remain in force.
- Actual React/JSX/UI bindings determine the host's advertised exports. Supported revisions are explicit sets, not numeric minimums. Missing exports and unsupported revisions produce an actionable error.
- Installation checks catalog metadata before download and verified package metadata before server acknowledgment. Incompatible updates retain the previous installed release and records. A later compatible release can update normally. The installer preserves the workspace-selected version rather than silently selecting another release.
- The renderer checks requirements before creating/importing executable URLs. Generated factories guard before module initialization, including on older hosts without capability metadata. Legacy bundles without requirements retain their existing validation path.
- See the [authoring contract](../../module-client-packages.md#host-ui-compatibility-sdk-04). No host UI styling changed.

## Verification

- Formatting and all 550 checked local documentation links passed. Strict type checks, dependency/copy checks and **four production builds passed** (`/tmp/gabs-host-ui-build-final.log`).
- **225 unit/PostgreSQL tests across 47 files passed in 54.78 seconds** on a freshly migrated/seeded temporary database, removed afterward (`/tmp/gabs-host-ui-full-final.log`). Thirteen focused SDK tests also passed in 2.88 seconds (`/tmp/gabs-host-ui-unit2.log`).
- Unit acceptance exercises exact inferred import requirements, default reexports/CommonJS, missing and future revisions, legacy packages, bounded malformed metadata, signed metadata disagreement in both verifiers, and a module initialization probe that remains untouched on incompatible hosts.
- **Five headless browser journeys passed in 33.7 seconds** on a temporary database (`/tmp/gabs-host-ui-browser3.log`): independently published TSX installation/writes, incompatible-update recovery, interrupted installation/uninstall preservation, development query/permission races and signed query/offline reconnect behavior.
- The final expanded compatibility journey passed in **13.6 seconds** (`/tmp/gabs-host-ui-browser-final.log`). It rejects a future revision before download, preserves local code and server records, then removes requirement metadata from the catalog response and proves the signed artifact check still rejects before an installation receipt changes. A subsequently published compatible release installs and reads the original record.
- **One hidden/unfocused Electron journey passed in 8.0 seconds** on a temporary database (`/tmp/gabs-host-ui-native.log`). It uses the independent signed query module and public UI bindings, asserts hidden/minimized and unfocused windows before and after, and verifies renderer isolation.
- Inspected captures: [wide compatibility error](incompatible-update.png), [390-pixel compatibility error](incompatible-update-narrow.png) and [compatible Electron module](electron.png). No horizontal document overflow at 390 pixels. Historical captures overwritten by regression runs were restored. Shared development data and existing preview services were preserved.

## Corrections and limits

The first browser run caught registry review's exact-manifest comparison, which now incorporates derived requirements. The recovery regression explicitly establishes its Projects installation prerequisite instead of assuming unrelated background installation has completed. The compatibility fixture restores desktop width before using its desktop navigation after narrow capture.

A query regression exceeded its unchanged loading timeout against the accumulated development registry; platform reads in that trace took approximately 1–2.3 seconds. The final browser and native suites used freshly seeded temporary databases. This establishes isolated functional acceptance, not acceptance of large-registry performance. OPS-07 and its unchanged load budgets remain open.

Requirements are conservative compatibility diagnostics for reviewed application code. They do not establish a hostile-code sandbox, automatic semantic equivalence, whole-product accessibility, signed production release readiness or final visual approval. Remaining schema/view composition acceptance, SDK-05 cross-module standalone capabilities and broader lifecycle/product gates remain open. GitHub Actions execution budget and artifact quota remain external remote-acceptance dependencies.
