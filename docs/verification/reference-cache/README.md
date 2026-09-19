# Bounded reference downloads

19 September 2026. Tracker: **OFF-02-REFERENCES**, within active OFF-02. Coverage: **CORE-003/BACK-002** and generated/custom offline lookup. Native acceptance remains required.

## Delivered behavior

Generated forms and independent public SDK clients share the same authorized lookup/cache path. Corporate reference downloads are scoped by account, workspace, source module release, source resource and declared target. Source and target permissions, active context, cancellation, device consent and the current offline lease are checked around asynchronous work. A server denial removes that target’s downloaded labels, including matching historical field caches. Online failures are never presented as cached success.

Each workspace retains at most 50 source/target buckets, 2,000 labels overall and 200 labels per bucket within a 1 MiB UTF-8 entry budget. The conservative entry accounting includes keys and timestamps; this is not a total workspace quota. Existing oversized caches migrate under the account/workspace storage lock. Orphan metadata is removed, and a subsequent unchanged read does not write another migration. The journal, drafts, records and executable artifacts are unaffected by label pruning.

Each label retains its own download time. Later lookups do not make older labels appear newly downloaded. Historical/invalid times remain unknown. Offline search, paging and selected-label resolution operate on the bounded downloaded subset, with provisional journal choices added separately and clearly labeled. Pending choices are never persisted as authoritative reference labels. Pickers display download freshness and invalidate previous labels immediately when their loader/target context changes; the selected identifier survives.

Cross-module cached lookup evidence is bound to the received workspace policy revision. A new policy revision requires a successful source lookup before those labels or cross-module pending choices can be reused offline. Unknown historical grant evidence also requires a connection. The server still authorizes every online lookup and business write; unreceived revocations remain subject to the approved offline lease limitation.

`ReferenceReadPage` carries optional typed provenance. Public `.references(query, { source: "server" })` refuses cached or source-unknown results. New bundles require `client.resources` revision 6, with earlier revisions still supported by the current host. Settings separately clears reference labels while retaining downloaded record pages and pending work; future authorized online lookups may download labels again.

## Verification

- Eight new unit scenarios cover durable bounded migration and idempotent reads, UTF-8 limits, per-label timestamps, selected-label removal, public SDK paging/search/provenance, post-I/O permission/lease loss, malformed responses, policy-revision revalidation, denial cleanup and account/workspace/source-release/resource isolation. Focused reference/compatibility checks passed **19 tests** in `/tmp/gabs-reference-cache-unit.log`.
- Full isolated unit/PostgreSQL regression passed **635 tests in 94 files**, `/tmp/gabs-reference-cache-regression.log`; the helper removed its database.
- Strict checks, boundary/copy checks and **four fresh production builds** passed in `/tmp/gabs-reference-cache-build-reviewed.log`. Final test-harness strict checks passed in `/tmp/gabs-reference-cache-types-final.log`; changed-source formatting passed too.
- **Six headless journeys passed** in `/tmp/gabs-reference-cache-web-final.log`: custom reference caching, generated nested reference fields, public client/server/local reference lookup, cross-module capture/revocation/recovery, selected offline lists and ordinary SDK cached reads. A final narrow Settings expansion passed in `/tmp/gabs-reference-cache-web-settings.log`.
- The new journey installs an independently signed fixture, downloads real labels, reloads offline, resolves choices with timestamps, creates a real pending Contacts edit, clears reference labels through Settings and verifies the exact journal/drafts/pages are unchanged. Reconnection accepts the edit. Live target-read revocation blocks the still-open picker, and another offline reload remains denied.
- Scoped Axe, overflow checks and five inspected captures: [custom wide](web-wide.png), [custom narrow](web-narrow.png), [Settings](web-settings.png), [Settings narrow](web-settings-narrow.png), [generated narrow](generated-offline-narrow.png). These are functional-change checks, not final design approval or whole-product accessibility conformance.

## Remaining acceptance

The current console session still reports the macOS screen locked. Protected SQLite/IPC and minimized native restart/authority/cache-clearing acceptance have not passed for this milestone. Desktop builds and browser results do not satisfy that gate. Broader working-set lease shortening/disabling, delayed-context transitions and profile recovery remain required. No entire original requirement or the overall parity goal is complete.
