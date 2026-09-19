# Downloaded resource-page cache

19 September 2026. **OFF-02 remains active.** This record covers bounded recent-page retention and download freshness, not complete working-set administration.

## Implementation

`packages/client/src/modules/cache.ts` owns the disposable resource-page cache independently of journal, drafts, review metadata, response contracts and executable artifacts. Each account/workspace keeps at most 50 downloaded query pages within a 5 MiB serialized UTF-8 page-entry budget. Recent known downloads take precedence over old/unknown timestamps. An oversized refresh removes the obsolete copy of that query instead of presenting it as current. The limit applies to page entries, not all workspace storage.

Reads migrate oversized historical page caches under the existing storage lock; writes enforce the same limits before the atomic root save. Interrupted persistence leaves the prior durable state intact. Orphan/invalid timestamps are removed; historical pages without timestamps report an unknown download time. The generated view rechecks current account, workspace, module release, read permission, storage consent and the corporate offline window before caching a completed request.

Offline pages show their download timestamp and state that the information may be out of date. A query without a downloaded page says so. This timestamp describes the local download, not a server guarantee of current data. Existing permission and lease checks still govern access. No stylesheet changed.

## Verification

Focused cache/storage checks passed: 93 tests in two files, `/tmp/gabs-resource-cache-unit.log`. These cover count/UTF-8 bounds, oversized refresh, legacy timestamps, malformed disposable entries, unchanged saved work, isolated workspace state and interrupted persistence. Final-source regression also adds explicit account-isolation verification.

Strict checks and four fresh builds passed in `/tmp/gabs-resource-cache-build-final.log`. The full isolated regression passed **611 tests in 91 files** in `/tmp/gabs-resource-cache-regression.log`; the temporary database was removed. **Four distinct headless journeys passed**: new/legacy same-record reload and filtered-page behavior in `/tmp/gabs-resource-cache-web.log`, then sorted-page acceptance in `/tmp/gabs-resource-cache-sort.log`. The first run was not clean: the sort fixture timed out waiting for a redundant request even though the correct records were displayed. The host uses a 15-second query freshness window. The fixture now verifies the existing record/order/offline-pagination outcomes without requiring that request; its rerun passed. No product behavior was weakened to satisfy the fixture. A final wording correction makes missing/evicted pages report “not available offline”; strict checks/four fresh bundles and the sorted/offline journey passed again in `/tmp/gabs-resource-cache-build-copy.log` and `/tmp/gabs-resource-cache-sort-final.log`. Strict checks including the final screenshot/test additions also passed in `/tmp/gabs-resource-cache-types-final.log`. Both [wide](web-wide.png) and [narrow](web-narrow.png) freshness captures were inspected; the new text is readable and does not introduce horizontal overflow. Existing scoped Axe/overflow assertions passed. Historical regression captures were restored. No native acceptance is claimed while the Mac’s protected storage is unavailable; the shared native journey now includes the same freshness assertion and must pass after unlock.

## Remaining OFF-02 requirements

Explicit authorized working-set selection/removal, reference-query cache bounds, user-facing cache management and full lease-shortening/expiry/connected-revocation journeys remain required. Global artifact/journal quotas are separate from disposable page retention; pending work must not be silently evicted to enforce a page budget. Full offline/profile acceptance and overall parity remain open.


## Selected-list follow-up

[OFF-02-LISTS](../offline-lists/README.md) adds user-selected multi-page downloads and cache controls. Selected pages now take priority over recent automatic pages; oversized refreshes preserve an older selected copy with its original timestamp. The current 617-test regression and browser acceptance include the earlier bounded-cache behavior. Native verification and broader OFF-02 gates remain open.
