# Native LAN lifecycle and SDK relay acceptance

18 September 2026. **SDK-05-LAN is locally verified within this scope. SDK-05, OPS-01 and full parity remain open.**

## Implemented

- Main-owned [session authority](../../../apps/desktop/src/main/lan/session.ts) binds provisioning, authenticated administrator policy, account, workspace and a maximum 24-hour lease. `SUITE_LAN_WORKSPACE` is now required alongside device certificates, allowed fingerprints and bounded private addresses. Starting the transport requires current online authority.
- Serialized enable/disable transitions cancel late authorization and discovery. Newer policy revisions survive stale responses and re-enable attempts. Lease expiry also stops discovery; logout closes listeners before cache purge. Other workspaces cannot see the enabled session or its peers.
- The [TLS transport](../../../apps/desktop/src/main/lan/transport.ts) pins discovered certificate identities, tries all three ports, handles fragmented UTF-8 frames, closes incomplete handshakes, bounds connections and coalesces overlapping scans/heartbeats. It retains one-minute heartbeats and ten-minute rescans.
- Public SDK relays require the signed module declaration and current permission, rechecked before sending. Pending content must name the calling account, workspace and module. The unused generic renderer relay method was removed.
- Incoming envelopes enter main-owned encrypted quarantine. Serialized writes preserve concurrent receipts; identical IDs/content can retry safely; an ID reused with different content is rejected. Renderer cache methods cannot read or write quarantine. Receipt is never corporate business acceptance.
- No production styling changed. LAN implementation files now live together under `main/lan/`.

## Executed verification

| Check | Evidence and result |
| --- | --- |
| Full regression before final review hardening | 345 unit/PostgreSQL tests across 70 files passed in a disposable migrated database. `/tmp/gabs-native-lan-unit.log`. |
| Final focused regression | Six real transport/session tests passed after review, including expiry during an unresponsive authenticated discovery request. `/tmp/gabs-native-lan-expiry.log`. |
| Strict environments, boundaries, copy and builds | Final `pnpm build` passed root and browser/node/preload/worker checks and all four build targets. Unaffected targets reused build cache. `/tmp/gabs-native-lan-build-reviewed.log`. |
| New hidden Electron journey | Signed independently published SDK fixture, actual Settings enable control, third-port fallback, foreign-workspace rejection, outgoing transfer, concurrent incoming receipts, retry/content collision, private-cache denial, live module-permission rejection, offline-lease revocation and logout cleanup. Final reviewed rerun passed. `/tmp/gabs-native-lan-native-reviewed.log`. |
| Existing hidden Electron regression | Native host export, revocation after a held dialog and stale-view cancellation passed. `/tmp/gabs-native-lan-native.log`. |
| Headless browser regression | Published SDK host export and undeclared/revoked/foreign-request rejection passed. `/tmp/gabs-native-lan-browser.log`. |
| Accessibility and inspection | Scoped Axe on native main content passed. [Settings](settings.png) and [module rejection](revoked.png) captures were inspected. Hidden/unfocused assertions passed; no OS notification or foreground acceptance window was used. |

The native fixture uses real mutual TLS on loopback with disposable test certificates and a migrated PostgreSQL database. The two peers are real Node TLS transports; Electron uses its actual preload, main process and encrypted utility storage. API development authentication substitutes for a real identity provider. Cadence tests advance the timer clock while retaining real sockets. Business tables remain empty after transfers.

Initial native acceptance needed two harness corrections: Axe must include the containing main content to reach the custom view's Shadow DOM; a denied enable can report either lease denial or cancellation when authenticated policy observation stops startup first. Both checks remain strict about rejection. Review subsequently found and fixed lease expiry during discovery, with a new regression and another native rerun. Historical host screenshots overwritten by regression runs were restored.

## Required follow-up

- Implement peer-list exchange and bounded distributed scan coordination, with explicit partition limits. Current coordination is per process only.
- Implement protected quarantine consumption: package signature/entitlement checks, verified artifact reuse, pending-envelope ownership/schema checks and explicit authoritative submission/recovery. Current receipts are durable quarantine, not adopted drafts or installed packages; the bounded ten-envelope inbox is not a completed processing pipeline.
- Design and verify offline startup/re-enable and module relay authority. Current module LAN capabilities and enablement require online authorization; only an already enabled listener survives within its offline lease.
- Verify certificate provisioning/rotation, deployment networks, multi-device partitions and all supported desktop platforms. Local certificates, development identity and an unpackaged hidden client do not establish production acceptance.
- Complete linked identity/recovery, notifications and remaining SDK-05 gates. UI refinement remains the separately authorized goal after parity.
