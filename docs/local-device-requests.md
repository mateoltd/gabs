# Standalone device requests

SDK-05 now separates local business transactions from external device effects. A local handler can commit a typed device request with its records. The host processes that request afterward, without holding the profile write queue during interaction.

## Authoring

Declare capabilities with the existing `capability()` API. In a `defineLocalModule` handler, use:

```ts
const requestId = await ctx.device.request("export", {
  filename: "notes.txt",
  content: text,
});
```

The alias and input schema are inferred from the module's declarations. The returned string identifies a pending request; it does not mean that a file was saved. [Typed acceptance](../tests/unit/local-device-requests.test.ts) includes compile-time rejection of invalid aliases and inputs.

Requests require current, exact-release profile consent. A public local service uses its own module's device consent; the caller's grant does not substitute for it. The worker verifies each participant and consent release binding. The host rechecks every returned request against current consent before committing.

Records, participating modules, operation receipts and device requests commit together. Rejection discards the transaction. Retrying an accepted operation returns its original receipt without adding another device request. Caught or detached invalid device requests fail the transaction, consistent with local resource and service validation.

Each transaction permits at most 16 device requests and 24 MiB of encoded request data. The encrypted device journal permits 256 entries and 64 MiB. These are independent of normal resource work; clearing a device request preserves business records.

## Host execution and recovery

`LocalSession.processDeviceRequest(id, executor, { signal, timeoutMs })` first claims a pending request durably, then releases the write queue. The host-owned executor receives an immutable call, profile/release authorization, a cancellation signal and `guard.assertCurrent()`. It must check the guard immediately before an effect, including after a dialog. This is not an API granting modules unrestricted native access.

Current consent, the original grant ID, the claim, profile state and cancellation are rechecked. Another device execution or dismissal cannot take over an active request. Local writes and revocation remain available while the executor waits. The default timeout is two minutes, with a maximum of ten minutes. Cancellation or timeout settles the processor even if an adapter has not settled; a retained guard cannot subsequently authorize an effect.

States are explicit:

| State       | Meaning                                                                                |
| ----------- | -------------------------------------------------------------------------------------- |
| `pending`   | Committed locally and awaiting host execution                                          |
| `running`   | Claimed durably by the current processor                                               |
| `completed` | A schema-validated host response was saved, including a known user cancellation result |
| `rejected`  | Authorization or preparation failed before invoking the adapter                        |
| `uncertain` | The adapter started but no verified result could be saved                              |

A repeated process call for a completed request returns the historical saved result without another effect. Unlock converts an interrupted `running` request to `uncertain`; it does not replay it. Failure after adapter invocation is conservative: an external effect may already have happened, even if the returned error suggests otherwise.

`retryDeviceRequest(id)` creates a linked pending request using fresh consent for the original call, without repeating the business operation. Duplicate retry calls return the same linked request. An uncertain source additionally requires `{ confirmUncertain: true }`, supplied only after the host interface has let the owner review the possible previous effect. A further failed retry is recovered from that linked request. `dismissDeviceRequest(id)` clears an inactive entry without deleting its business records.

Updates and uninstall revoke the original capability grant, so retained pending payloads cannot execute through a different release. Recovery preserves them for review; it does not silently retarget their input to new module code.

## Owner controls and device adapters

The local workspace's **Device requests** dialog shows committed requests separately from business records. Owners run pending work, cancel ongoing requests, review uncertain outcomes before retrying, and clear inactive entries. A retry creates a linked request without repeating the original business operation. If a concurrent vault change prevents saving the outcome, lock/unlock recovers it for review.

Browser execution offers actual downloads and permission-checked notifications. Electron owns the native file chooser and write, using a single-use session and fresh challenge callbacks to the trusted profile host, including after the chooser returns. Cancellation and stale consent invalidate later writes. The descriptor alone is not authority; current vault/release/consent validation remains in the trusted profile host. Native main does not independently decrypt that vault.

Local profiles cannot borrow corporate LAN authority. Native local network status reports disabled, and relay requires an authorized corporate workspace. Notification support depends on the browser/OS; a request is not proof of presentation. See [actual effect acceptance and limits](verification/local-device-effects/README.md).

## Compatibility and remaining integration

New local builds use signed `suite-local-v2` bundles. The host still accepts retained `suite-local-v1` bundles. Older hosts reject v2 at their local artifact check. Registry migration `028_local_device_runtime.sql` permits both formats while preserving the existing submission, server-staging and executable-size checks.

The durable broker, browser/native effect adapters and owner recovery controls have scoped local acceptance. Corporate offline capability leases, standalone development simulation, actual OS notification presentation and positive corporate native LAN acceptance remain open. No module operation should present a queued device request as a completed effect.
