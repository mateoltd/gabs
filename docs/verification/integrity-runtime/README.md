# Runtime integrity lockdown and saved-work recovery

Scope: runtime monitoring, IPC admission and persisted-work preservation within **ID-04**. These paths have scoped local acceptance. ID-04 remains **active** for operational delivery and real provider/signed-platform acceptance; [integrity support recovery](../integrity-support/README.md) now has scoped local evidence.

## Runtime behavior

- The shared installation inspector runs every 60 seconds and on resume. Concurrent checks share one inspection; a detected fault permanently locks the current process. Repair requires a new process and the existing startup verification/recovery gate.
- A single before/after guard now owns every main-process IPC registration, including delegated local-device and LAN recovery handlers. Calls cannot begin after lockdown or return late values across it. Existing sender, scope, permissions and profile checks remain in their feature owners.
- Lockdown aborts authoritative transport, cancels sign-in, invalidates corporate and local capabilities, closes vault sessions and the renderer, stops LAN activity and clears the old global credential/identity. Storage opening and secure reads/writes also check the gate. Activation and secondary-instance events cannot reopen the locked view; application asset serving refuses further requests.
- Already-issued work gets a bounded settlement interval before the utility closes. Local incident publication happens before normal shutdown. A deadline prevents a stuck audit/cleanup operation from keeping the application alive indefinitely. The error dialog cannot prevent exit if showing it fails. Neither local rejection nor client cancellation claims that a server commitment was rolled back.
- No queue, draft, database or saved-profile directory is purged. Recovery uses current authentication and original request identities to determine authoritative outcomes. This preserves durably captured work; it does not promise to recover input that had never reached durable storage.

## Actual acceptance

The [compiled-process probes](../../../tests/desktop/integrity.spec.ts) use copies of the real build. Runtime modification of preload triggers the actual resume handler. During the real audit write, calls to seven representative feature families are denied: server execution, cache, local vault, saved profiles, local devices, LAN recovery and security status. A real server connection reply held across lockdown also fails to return success. Startup corruption/repair continues to pass with duplicate-safe incidents and credential removal.

The [encrypted-work journeys](../../../tests/desktop/integrity-work.spec.ts) create a company and actual Contacts request/draft through the product. Two boundaries are covered:

1. The request is captured offline and has no server effect when lockdown occurs.
2. The server has committed the exact captured request, but its response is held by matching the original idempotency key. The local journal has not accepted it when lockdown occurs.

Both journeys restart the repaired build in the same independently protected profile and perform fresh UI sign-in. Before delivery resumes, the original request identity/call and separate draft remain intact. Current server state distinguishes the unsubmitted and already-committed cases. Subsequent synchronization uses the original request and yields exactly one record, one create audit entry and an accepted journal result; the unrelated draft survives. Each integrity incident has one locked event and one recovery event. Development authentication and OS-key callbacks are controlled fixtures, not actual-provider acceptance.

## Verification, 20 September 2026

- **13 focused tests passed** across startup and runtime checks. Runtime tests cover periodic scheduling, overlapping inspections, permanent locking, transport cancellation, late results, failure handling and guarded registration. `/tmp/gabs-runtime-integrity-unit.log`.
- Strict root/browser/Node/preload/worker checks, boundaries/copy checks and four build targets passed; desktop was freshly rebuilt and the other three targets used cache. `/tmp/gabs-runtime-integrity-build-final.log`. Final fixture-only changes have a separate strict/lint/format check; no new full regression is claimed.
- The final six-case native run passed five cases. The accepted-request fixture failed because a read shares the records endpoint; the response gate now matches the exact request identity, and the corrected accepted-request case passed. This is cumulative acceptance for **six native cases**, not an uninterrupted six-pass run. `/tmp/gabs-runtime-integrity-final.log`, `/tmp/gabs-runtime-integrity-accepted.log`.
- Both native encrypted backup/restore regressions passed in that run, including interruption after commit. Earlier standalone runtime and work runs passed after their fixture corrections. All disposable databases were removed, and tests remained hidden/minimized and unfocused.
- Four final wide/narrow recovery captures were inspected. Scoped Axe A/AA and horizontal-overflow checks passed. The shared renderer UI and styles were not edited; this is functional/visual continuity, not final UI approval.

Earlier fixture corrections selected the real connection endpoint instead of health, expanded the saved-draft disclosure before asserting its content, and narrowed the held record response to the exact mutation identity. The product implementation was not weakened to accommodate these fixtures.

| Recovered work | Wide | Narrow |
| --- | --- | --- |
| Previously offline request and draft | [Capture](recovered-offline.png) | [Capture](recovered-offline-narrow.png) |
| Server-committed request and draft | [Capture](recovered-accepted.png) | [Capture](recovered-accepted-narrow.png) |

## Remaining work

- [Inspection/export and retained audit repair](../integrity-support/README.md) now have local command and interrupted-process acceptance. Real foreground dialog and broader operational support journeys remain required.
- Real signed/installed platform, identity/OS-provider and physical durability acceptance. Simulated providers, controlled disk edits, emitted resume events and process exits do not establish these gates.
- Operational audit delivery and monitoring. Local integrity receipts are not tamper-proof server records.

Detection has an interval and cannot guarantee discovery before every possible effect. Electron/OS integrity checks can terminate before main runs, and replacing the trust anchor or compromising the operating system remains outside the claimed protection. See the [startup evidence](../integrity-startup/README.md) for package-signing details and limitations.
