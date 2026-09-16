# SDK-02: durable local module downloads

16 September 2026. Local module downloads now survive interruption before installation begins. Each completed, verified package is committed to the encrypted profile before the next package is requested. SDK-02 and full functionality parity remain active.

## Behavior

- `beginDownload` persists the selected root, required module versions and originating account/personal workspace. Repeating the same selection resumes its stable request; changing the source or selected versions requires discarding the old download explicitly.
- `saveDownload` verifies the package signature/checksum, identity/version and standalone support before persisting its bytes, trust key and configuration defaults. Saved bytes are immutable. Invalid or cancelled writes do not become available, and the existing revision check rejects stale windows or removed/locked profiles.
- Resume requests only missing packages. The original account and personal workspace must be connected, and each request passes the server's current access checks. A changed available version fails with recovery instructions. Already downloaded standalone packages remain part of the explicitly local profile and can be reviewed offline.
- Saved downloads have visible progress, resume/review, cancellation and discard controls. Starting a download or receiving an error brings the status area into view; progress is announced as status text. Existing host components/styles are retained.
- `installDownload` revalidates signatures, configuration, compatibility, current consumers and pending operations through the existing atomic set installer. The transition removes the saved download and stages its complete recoverable installation attempt in one encrypted commit. A subsequent migration failure remains recoverable through unfinished installations. Configuration validation failures retain the download for correction.
- Download removal does not remove installed modules, records or operation receipts. Separate encrypted profiles do not share download sets.

## Acceptance

- **153 unit/PostgreSQL tests**, strict types, dependency/copy checks and all four builds passed. A final build passed after the dialog scroll correction.
- **Eight headless browser cases** passed across the local worker, controls, dependencies and new download suites. The new real-interface journey interrupts the second package, reloads/unlocks, verifies persisted first-package progress, revokes access to the missing package, restores access, downloads only that package, reviews offline and executes the installed worker with its configured prefix. The provider was requested exactly once. The dialog passes scoped Axe checks and width containment at 390 px.
- The separate profile-boundary case verifies corrupt bytes, changed versions, incomplete installation, source-account mismatch without any network call, offline missing-package recovery, cancellation, stale-window commits, invalid configuration retention, accepted transfer and data-preserving discard. It locks/unlocks between stages and checks profile isolation.
- **Three distinct minimized/unfocused Electron cases** passed. The expanded packaged-worker case saves both packages, closes the native process, restarts offline, reviews and installs through the actual UI, then continues its existing interrupted two-module migration/restart/receipt recovery. The packaged worker URL and native window state are asserted. The controls and worker-restart regressions also passed.
- A final internal boundary refinement keeps download consumption separate from ordinary install options; two focused browser cases and the native restart/package case passed again.
- After visual review exposed a scrolled-past error/status, the scroll correction passed two focused browser and two native cases again. Inspected [wide interruption](interrupted.png), [narrow interruption](interrupted-narrow.png), [installed local record](installed.png) and [native saved set after restart](desktop-ready.png). This does not establish whole-product accessibility or final UI approval.

## Limits and next work

Recovery is at verified package boundaries. An incomplete individual HTTP response is requested again; previously completed packages are retained. Configuration edits in the review form become durable when installation is submitted. This is not HTTP byte-range continuation or a remote authorization lease for standalone personal execution.

Local lifecycle history/reporting and a general retained-release rollback selector remain open, alongside richer schema/view coverage in SDK-04. Personal-to-company import, full-file native SQLite encryption, hosted trust rotation and broad release acceptance remain separate requirements. No corporate business changes become authoritative locally.

## Remote checkpoint

Prior `fe29c36`, [CI 35146851386](https://github.com/mateoltd/gabs/actions/runs/35146851386), passed 76 headless browser cases, code/build checks, three unsigned desktop packaging jobs and a two-second logical restore. Its unchanged load budgets failed at 1,456/2,479 ms. The subsequent performance candidate `d609718`, [CI 35148323090](https://github.com/mateoltd/gabs/actions/runs/35148323090), passed all 76 browser cases, code/build, three unsigned packaging jobs and a three-second logical restore. Load improved to 638/1,598 ms but still failed the unchanged 500/1,000 ms budgets; the diagnostic repeat was 680/1,454 ms. OPS-07 remains open.
