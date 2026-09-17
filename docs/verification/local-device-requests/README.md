# Standalone device request journal and broker

17 September 2026. SDK-05 remains active. This milestone verifies the typed worker contract, atomic encrypted request journal and host-owned processing lifecycle. Actual standalone device adapters and request-management UI remain required.

## Implementation evidence

- [Public device contracts](../../../packages/sdk/src/contracts/local-devices.ts) infer capability aliases and inputs for `ctx.device.request`. A returned ID identifies a pending device request rather than a completed effect.
- [Local runtime](../../../packages/sdk/src/runtime/local.ts) collects bounded requests with transaction records and the root receipt. Public services use the provider's own device grant. Failure, including a caught or detached invalid request, discards the transaction. Receipt replay adds no device requests.
- [Worker verification](../../../packages/client/src/local/runtime.ts) binds device grants to verified participant releases. The [profile host](../../../packages/client/src/identity/local-profiles.ts) rechecks returned requests and saves them atomically with records and receipts.
- [Device processor](../../../packages/client/src/identity/local-devices.ts) durably claims a request, releases the write queue for interaction, rechecks original consent and active scope, validates results and records explicit outcomes. Cancellation, lock and bounded timeout invalidate late guards. Interrupted claims recover as uncertain without automatic replay.
- Device-only retry requires fresh consent, preserves business records and links a new request to its source. Duplicate retry calls recover that linked request. Uncertain outcomes require explicit review acknowledgement. Completed processing calls return their historical result without invoking the adapter again.
- The builder emits signed `suite-local-v2`; retained v1 remains supported. [Registry migration 028](../../../packages/server/migrations/028_local_device_runtime.sql) extends the format allowlist while preserving the existing executable, identity and backend checks.

## Executed checks

| Check                                                                                  | Result                      |
| -------------------------------------------------------------------------------------- | --------------------------- |
| Fresh migrated/seeded PostgreSQL full unit/integration suite                           | 265 passed across 58 files  |
| Final local/host unit checks after input-snapshot and byte-accounting hardening        | 42 passed across 9 files    |
| Strict types, browser/Node/preload/worker boundaries and all production builds         | Passed; all 4 bundles built |
| Headless grant authority, consent UI and signed device request proof                   | 3 passed                    |
| Expanded device request proof after final hardening, including owning-page termination | 1 passed                    |
| Hidden native consent and signed local-package execution/restart regressions           | 2 passed                    |

The full 265-test run preceded the final input-cloning/encoded-size hardening and one added unit case; the final focused 42-test run includes that case. Counts are not additive. The final expanded browser proof ran against the hardened runtime. No later full-suite run or remote CI acceptance is claimed.

The first new browser attempt found the registry database's v1-only format constraint. Migration 028 corrected that compatibility gate, and the later run built, submitted, reviewed, published and installed the independent v2 package successfully. Every acceptance database was created, migrated, seeded and removed by the isolated runner.

## Observable recovery proof

The [browser test](../../../tests/e2e/local-device-requests.spec.ts) uses actual signed executable workers and encrypted IndexedDB profiles while offline. It verifies atomic rollback, stable receipt replay, grant persistence, independent writes/revocation during delayed interaction, duplicate processing, durable completion, stale consent, invalid adapter results, cancellation, timeout, lock, device-only retry and data-preserving uninstall. It then closes the owning page without locking the profile or saving an outcome. A new page unlocks the same vault, finds the request uncertain, preserves the saved record and refuses to invoke the adapter again.

The adapter callbacks in this proof are controlled effect boundaries, not actual file downloads, native save dialogs, OS notifications or LAN transport. Native regressions verify that the new runtime format and existing consent still work in packaged output; they do not establish native device processing. Historical consent and executable screenshots were restored after regression runs. No UI or theme styles changed.

Logs: `/tmp/gabs-device-queue-full-unit.log`, `/tmp/gabs-device-queue-unit-final.log`, `/tmp/gabs-device-queue-build-final.log`, `/tmp/gabs-device-queue-browser-final.log`, `/tmp/gabs-device-queue-browser-recovery.log`, `/tmp/gabs-device-queue-native.log`.

## Next acceptance

Connect real standalone browser and narrowly scoped native effect adapters to this processor. Add owner-facing pending/completed/rejected/uncertain request states, cancellation, reviewed retry and clearing without conflating business completion with device completion. Verify delayed native authorization and context changes. Corporate offline capability leases, positive native LAN, general identity/storage hardening and full platform parity remain open.
