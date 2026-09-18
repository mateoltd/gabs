# Verified received-package reuse

18 September 2026. **SDK-05-LAN-PKG is locally verified within this scope. SDK-05, OPS-01 and full parity remain open.**

## Implemented behavior

- The public [`artifactRelays`](../../../packages/sdk/src/contracts/relay-artifacts.ts) helper splits signed packages into deterministic, retryable 64 KiB frames. Package size and aggregate advertised storage are bounded at 64 MiB; at most four transfers are retained per account/workspace. Physical base64/encryption/database overhead is additional.
- [Main-owned package staging](../../../apps/desktop/src/main/lan/packages.ts) persists partial transfers separately from pending business receipts. Out-of-order and duplicate chunks are safe, changed content is rejected, orphan chunks are pruned, and an invalid optional index can be rebuilt without touching drafts. Old reconstructable packages can be evicted. Partial transfers survive a full application restart.
- [The utility verifier](../../../apps/desktop/src/utility/lan-package.ts) assembles bytes, checks the aggregate hash, validates the signature and compares the exact signed header. This work runs in the encrypted storage utility process.
- The metadata-only registry endpoint uses the full artifact route's current authorization, dependency entitlement, selected-release/storage/pin resolution and signature verification. The native host fetches that metadata before and after verification and uses current registry trust. Peers supply bytes, never authority.
- [The normal installer](../../../packages/shell/src/features/modules/installation/index.ts) reuses verified received bytes before attempting a registry download. It independently verifies them, writes its durable download cache, acknowledges transport storage and obtains the ordinary authoritative installation receipt before activation. Existing host/dependency checks and retry identities remain intact.
- Corrupt packages fall back to the normal registry repair path. Authorization failures reject reuse. Small legacy whole-package quarantine receipts receive the same checks and exact-receipt cleanup. See [authoring and operational limits](../../lan-package-relay.md).

## Executed verification

| Check | Evidence |
| --- | --- |
| Full regression | 360 unit/PostgreSQL tests across 72 files passed in a fresh migrated/seeded database before the final damaged-index recovery correction. `/tmp/gabs-lan-package-full.log`. |
| Final focused checks | 20 transport/session/draft/package tests passed after that correction. The eight package cases cover Unicode frames, malformed sizes, restart, out-of-order duplicates, missing chunks, collisions, account/workspace isolation, stale profiles, changed pins, revoked access, corrupt aggregate/signature data, legacy receipts, orphan cleanup, damaged-index repair and aggregate/count quotas while preserving drafts. `/tmp/gabs-lan-package-guard.log`. |
| Server metadata | Real PostgreSQL acceptance checks exact metadata against full signed packages, foreign-workspace rejection, dependency entitlement denial and an existing Inventory 1.1 pin. Included in the full regression. |
| API and builds | API schemas regenerated on an isolated database. Final root/browser/node/preload/worker types, boundary/copy checks and all four build targets passed; three unchanged targets reused the preceding successful build cache. `/tmp/gabs-lan-package-api.log`, `/tmp/gabs-lan-package-build-final.log`. |
| Hidden native package journey | Independently built executable package spanning more than three frames; real mutual TLS; partial transfer; main/utility restart; reauthentication; duplicate/resumed transfer; missing/revoked entitlement denial; utility verification; normal installation and visible custom view. Full registry package downloads were deliberately blocked: **zero were attempted**, metadata was fetched, and the database recorded the exact server-accepted installation. The package cache was acknowledged and the draft inbox stayed empty. Final affected rerun passed. `/tmp/gabs-lan-package-native-final.log`. |
| Native regressions | Existing positive scoped SDK relay/revocation and received-draft review/lost-response/restart/idempotency journeys passed. Scoped Axe passed; fresh wide/narrow recovery captures were inspected, then historical artifacts restored. `/tmp/gabs-lan-package-native-regression.log`. |
| Headless browser regressions | Signed repair/dependency-safe removal and background assigned-module installation passed. `/tmp/gabs-lan-package-browser.log`. |

All Electron windows remained hidden or minimized and unfocused. No UI source or style changed. This is local loopback, development identity and test certificate acceptance; it is not live-provider, production release signing, physical deployment-network or all-platform acceptance. The download-blocking hook affects only the tested package endpoint and does not bypass metadata authority or the final server installation command.

Initial authoring checks caught missing required fixture fields and cyclic initializer type inference; both were corrected before acceptance. Final review then identified that an invalid optional transfer index could block unrelated installation. It now repairs only the reconstructable package namespace, with an additional focused regression and a fresh strict build/native package run.

## Remaining required work

[Archive/file recovery and capacity](../lan-life/README.md) were subsequently verified. SDK-05/OPS-01 still require remote dependency acknowledgements, inactive-version reconciliation, broader employee authority, offline LAN startup/module relay, peer-list exchange and distributed scan coordination. Automatic package selection/sharing controls remain distinct from this verified receive-and-install path. Certificate deployment/rotation and supported-platform/network acceptance remain required. Sign-out/profile-removal recovery remains OFF-03/ID work. No requirement is silently deferred; the later UI refinement goal remains queued until full parity.
