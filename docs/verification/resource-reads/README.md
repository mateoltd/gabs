# Cached resource reads through the public SDK

19 September 2026. Tracker: **OFF-02-SDK**, within active OFF-02. Coverage: **CORE-003/SHELL-001** and typed custom-view resource access. Protected native acceptance remains required.

## Delivered behavior

Corporate custom views can read exact downloaded lists and individual records offline through ordinary public SDK methods. Online responses are schema-validated and cached only with current device consent and authorization. Reads stay inside the account/workspace and exact module release/resource; filtered list queries retain their exact pagination identity. Individual reads can reuse complete list rows, preferring the highest known record version and then the newest download time. The shared page-entry budget also bounds individual record entries, and pending work remains separate.

The public result includes optional typed provenance, with a nullable historical download time. The host overwrites supplied source claims and shows its own notice when a view consumes downloaded data. A server-only read fails offline or when a transport cannot establish server provenance. It does not convert a cached result into an authoritative result. New client bundles require resource contract revision 5; compatibility diagnostics reject older hosts before module initialization. Existing host revisions remain supported.

Access is checked before and after asynchronous work: current scope/release/view/resource permission, cancellation and offline lease/consent. Cached data is revalidated. Requests snapshot query identity before transport, and neither online failures nor missing downloads trigger an unrelated cached success. Operations and reference requests keep their existing execution rules.

## Verification

- Ten focused read scenarios cover durable list/get reads, untrusted provenance, exact scope/release/filter identity, server rejection, delayed access loss, consent/lease changes, unknown historical timestamps, invalid schemas/IDs/requests, cancellation, public server-only semantics, compile-time rejection of invalid contracts, mutable caller input and record reuse/version ordering.
- Final full isolated regression: **627 tests in 93 files**, `/tmp/gabs-sdk-reads-regression-final.log`; the helper removed its database. The earlier implementation also passed 626 tests before the list-to-record refinement.
- Strict checks, boundary/copy checks and four fresh production builds passed in `/tmp/gabs-sdk-reads-build-records.log`.
- Four headless browser journeys passed in `/tmp/gabs-sdk-reads-web-records.log`: the independent signed custom-view read journey, executable module installation/writes, incompatible host update handling and selected offline-list management. The helper removed its database.
- The new journey builds/publishes a fixture into the isolated local registry, installs it through the real host, downloads a list, reloads offline, opens a record never individually fetched online, verifies both source notices, refuses authoritative requests, reports missing filtered downloads, locks at 25-hour expiry, reconnects for server reads, then applies read revocation and verifies it remains unavailable after another offline reload. No offline authoritative write reaches PostgreSQL.
- Scoped Axe, narrow overflow checks and inspected 1440/390 captures: [wide](web-wide.png), [narrow](web-narrow.png). These verify this change, not final UI polish or whole-product accessibility conformance.
- The first browser attempt exposed two fixture buttons implicitly submitting the form and clearing the expected error. Explicit button types corrected the fixture; the corrected and final journeys passed without weakening read-policy assertions.

## Limits and next work

Native SQLite/IPC execution and minimized desktop restart/expiry/revocation acceptance have not passed for this milestone while OS-protected storage is unavailable. Do not treat the shared client implementation or a successful desktop build as native acceptance. Offline reference-cache bounds, profile recovery, wider working-set/lease journeys and the broader parity gates remain open. Simulation/local transports may omit provenance; they do not acquire corporate authority from this contract. No broad original requirement or the overall parity goal is complete.
