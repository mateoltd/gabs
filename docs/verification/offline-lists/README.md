# Selected offline lists

19 September 2026. Tracker: **OFF-02-LISTS**, within active OFF-02. Coverage: **CORE-003/SHELL-001**, generated resource views and disposable cache management. Native acceptance remains required.

## Delivered behavior

Generated corporate resource views offer named offline lists using the current search, filters, sort and page size. Downloads start at the first page and respect the chosen record limit. The UI explicitly identifies a truncated selection. Users can open the saved filters, refresh the selection, remove it, or clear recent unselected pages. Settings also clears this workspace’s downloaded lists/pages, including selections whose former module/resource is unavailable, without deleting drafts, requests, reviews, executable artifacts or response contracts.

The client downloads through the ordinary authoritative resource API, validates each response and rechecks current host access/connectivity before each request, after responses and at commit. A complete download commits under the existing account/workspace storage lock. Interrupted or rejected downloads leave prior selections unchanged. A concurrent removal/refresh prevents a stale in-flight refresh from resurrecting or overwriting that selection.

Selected pages take priority over recent automatic caching within the shared 50-page/5 MiB UTF-8 page-entry budget. At most 20 named lists are retained. Over-budget explicit downloads fail without replacing prior data; oversized automatic refreshes retain the older selected copy and its original download timestamp. Shared pages remain while another list selects them. Removing/clearing downloads never deletes pending work or pretends it was accepted. This is a page-entry budget, not a total workspace-storage quota.

Portable query-key generation and cache selection live in the client. Network coordination lives in `packages/client/src/modules/offline-lists.ts`; host controls live under `packages/shell/src/features/modules/offline`. The generated view uses the same cache-key contract, preserving existing filtered/sorted pagination. No stylesheet changed. Saved selection never grants access, bypasses a lease or finalizes a business operation.

## Verification

- Six new unit scenarios plus the four existing cache cases passed in `/tmp/gabs-offline-lists-unit.log`: pagination/truncation, post-response revocation, interrupted later pages, concurrent removal, selected-page retention/shared references, byte-budget rollback, invalid responses and repeated cursors.
- Full isolated unit/PostgreSQL regression: **617 tests in 92 files**, `/tmp/gabs-offline-lists-regression.log`. The helper removed its database.
- Strict checks, dependency/copy checks and **four fresh production builds** passed in `/tmp/gabs-offline-lists-build-reviewed.log`. A final Settings heading/copy adjustment passed the same checks and fresh builds in `/tmp/gabs-offline-lists-build-presentation.log`.
- **Five headless journeys passed** in `/tmp/gabs-offline-lists-web-final.log`: the new selected-list workflow plus new/legacy journal reload, ranges and sorting. The final presentation recheck passed in `/tmp/gabs-offline-lists-web-presentation.log`.
- The list journey downloads 35 real Contacts across four pages, creates a shared truncated selection, clears only recent pages, reloads offline, browses a downloaded second page and captures a real queued edit. Removing one shared selection preserves the other and exact pending work. Reconnection accepts the edit; explicit refresh includes a newly created 36th server record. Offline removal and the Settings clear control preserve exact retained journal entries.
- The journey is shared by web and native wrappers. After extraction, strict checks passed in `/tmp/gabs-offline-lists-harness-types.log` and the same browser workflow passed again in `/tmp/gabs-offline-lists-web-shared.log`. The native wrapper uses actual protected storage, process restart and hidden/minimized, unfocused Electron; it has not been executed while the Mac is locked. It fails explicitly if protected storage is unavailable rather than substituting simulated storage.
- Scoped dialog Axe and overflow checks passed. The [wide](web-wide.png), [narrow](web-narrow.png), [narrow actions](web-narrow-actions.png) and [Settings](web-settings.png) captures were inspected. Short visible action labels retain contextual accessible names. These checks do not establish final UI approval or whole-product accessibility.

The first browser run exposed a real defect: local list refetches paused when disconnected, leaving removal stuck on “Working…”. The local query now uses `networkMode: "always"`; the corrected workflow passed in `/tmp/gabs-offline-lists-web-fixed.log` before the final regression above. Failure evidence remains in `/tmp/gabs-offline-lists-web.log`.

## Remaining acceptance and implementation

Run `tests/desktop/offline-lists.spec.ts` through the isolated helper after the Mac/login keychain is unlocked. Native cache/collision acceptance remains separately required. No native pass or production-release acceptance is claimed.

Reference-query cache bounds and full lease-shortening/expiry/connected-revocation journeys remain under OFF-02. The custom-view transport in `custom-view.tsx` still rejects all ordinary SDK reads offline; leased access to already-downloaded resource data through that public SDK path remains an implementation gap, now tracked as OFF-02-SDK. Generated-view list selection does not close that gap. Historical-release transitions, wider profile recovery and overall parity remain open.
