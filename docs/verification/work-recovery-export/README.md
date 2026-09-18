# Saved-work export checkpoint

Status: implementation in progress under OFF-01. Checkpoint `168834e` preserves the current source and browser captures before the delegated architecture review. This is not feature acceptance.

The implementation adds portable saved-request and draft exports from Settings, including retained original contracts and reviews. Exported observations do not grant authority to execute or import business changes. Browser and native adapters recheck current access; native saves reauthorize after the save dialog.

## Evidence and remaining verification

- Twelve focused saved-work/native-authority tests passed before the final browser authorization changes (`/tmp/gabs-work-export-unit.log`).
- Four headless browser journeys passed before the final policy-refresh/revocation test changes (`/tmp/gabs-work-export-web.log`). The eight captures here belong to that earlier run and have not yet received visual acceptance.
- The final source passed strict TypeScript/environment and dependency/copy checks. All four application builds completed fresh in `/tmp/gabs-work-export-build.log`; the architecture review subsequently reran strict checks and reused the four valid build outputs.
- Rerun the four browser journeys on final source, then run their hidden/unfocused native counterparts. The newly added in-flight permission-revocation cases have not yet passed observable acceptance.
- Verify advanced review/collision exports in real interfaces, run relevant export regressions and the full unit/PostgreSQL suite, inspect new captures, and update the workflow documentation and requirement evidence before accepting this milestone.

The architecture checkpoint does not close OFF-01 or any broader parity gate. Historical captures overwritten by the earlier browser run were restored from `c1ae747`; the new captures remain here for subsequent review.
