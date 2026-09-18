# Bounded LAN peer discovery

Recorded 18 September 2026 for OPS-01-MESH and SDK-05. This is scoped local transport acceptance, not completion of OPS-01, SDK-05 or platform parity.

## Implemented behavior

- Workspace-bound protocol-2 peer-list exchange over provisioned mutual TLS. Indirect endpoints require a fresh exact-pin verification and cannot expand the configured address, port or identity allowlists.
- Two concurrent discovery/control probes, bounded peer tables, bounded frames and candidate verification. Existing relay authorization and server acceptance remain unchanged.
- Fingerprint-elected coordinator and merged, saturating reservations permit at most two subnet scans per address in a connected common clock round. Each transport also has its own two-attempt cap. Stop/start preserves that cap and rechecks known endpoints as hints.
- One-minute heartbeat, ten-minute rescan, three-port fallback, legacy acknowledgement support, coordinator replacement and cancellation-safe shutdown.

[Protocol behavior and limits](../../lan-discovery.md) distinguish subnet scans from heartbeat traffic. Startup races, partitions, clock disagreement, process reconstruction and legacy peers do not offer a global two-scan guarantee. Lost reservations can reduce available scan capacity until the next round. No discovery message grants business authority.

## Verification

| Check | Result |
| --- | --- |
| Strict checks/builds | Root/browser/node/preload/worker TypeScript, dependency/copy checks and all four builds passed. `/tmp/gabs-lan-mesh-build.log`. |
| Full regression | 370 unit/PostgreSQL tests across 73 files passed on an isolated migrated/seeded database. `/tmp/gabs-lan-mesh-full.log`. |
| New protocol checks | Five tests cover saturated-table convergence, clock rollback/stale/future rejection, malformed/oversized tables, actual TLS hint exchange, out-of-policy endpoints, wrong pins, foreign workspaces, forged reservation ownership, connected scan limits and coordinator loss. Partition convergence is a deterministic table test; this does not establish multi-host deployment partition acceptance. |
| Existing transport checks | All six real-TLS/lifecycle/session tests passed, including three-port fallback, scheduled heartbeat/rescan, cancellation, restart, protected receipt capacity, lease expiry and logout. |
| Hidden native regression | All three journeys passed: module-scoped TLS draft relay with protocol-2 coordination assertions; interrupted executable transfer/restart/installation without full registry download; and received-draft review/server submission/retry/archive/file recovery. `/tmp/gabs-lan-mesh-native.log`. |
| Interface preservation | Native scoped Axe checks passed. Inspected [current Settings](native.png); no UI source changed. Historical native-LAN screenshots were restored after the run. |

All Electron windows stayed hidden/minimized and unfocused. Save/open dialogs were controlled by tests; actual IPC, filesystem, protected storage, TLS and server effects were exercised. Development identity and loopback certificates do not prove production-provider or deployment-network acceptance.

The initial lifecycle run exposed peers disappearing after a stop/start with a consumed scan allowance. Retaining known endpoints as untrusted-until-reverified hints fixed it while preserving the cap; the complete final regression passes. No migration, API schema, signed module release or shared preview was changed.

Remaining: the persistent shell peer indicator (OPS-01-STATUS), employee/offline authority, inactive-version/remote-dependency recovery, real deployment partitions, provisioned production certificates and other platform acceptance. OPS-01, SDK-05 and full parity remain open.
