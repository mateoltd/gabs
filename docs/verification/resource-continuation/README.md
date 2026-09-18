# Public queued resources and command dependencies

Status: OFF-01-RESOURCE locally verified within the scope below. Full OFF-01 and product parity remain incomplete.

## Contract and ownership

Queued resources expose `client.resource(name).queue.create/update/archive/get` through the public SDK. Receipt types infer resource data, distinguish each action's original input and expose a confirmed result only after acceptance. Resource declarations retain their execution policy in the inferred type. Known online/local resource policies reject queued authoring at compile time; runtime validation also checks policy, append-only restrictions, input, versions, retry keys and receipt identity.

The client owns durable capture. Requests retain their original signed release, stable key, record target, update base and explicitly requested prerequisites. Reusing a key for different input or originally requested dependencies fails. Separately reviewed continuation may change active scheduling dependencies without rewriting the request. Capture that commits before authority changes retains its identity and pending work, even if acknowledgment fails. Reads are account/workspace scoped and require current host access.

The existing shell adapter now supplies both command and resource queues under current view/resource permissions, device-storage consent and leases. Dispatch still uses the client-owned workspace coordinator and authoritative server validation. Settings already owns original resource-input inspection and recovery; no new recovery UI or style was introduced. Module-development worker transport and permission/offline simulation expose the same resource methods.

Newly compiled views require `client.resources` revision 4. Hosts retain revisions 1–3 for existing signed releases. The new contract describes API availability, not permission or offline authority; a host without a resource queue adapter reports that it is unsupported. Signed historical packages and their identities are unchanged.

## Observable acceptance

The independent fixture publishes and installs two modules through the existing registry. It captures a parent command and two dependent resource creates using public SDK methods. After parent rejection, only the explicitly selected child is approved. Review and selection survive offline restart. Revocation during a held settlement response preserves original calls and the saved review; regrant permits explicit continuation. The unselected child stays pending on its original prerequisite.

The same journey captures an update from a real downloaded server record, restarts offline, inspects original/saved values in Settings and reconnects. It subsequently captures an archive from the newly downloaded accepted version and restarts again. Pending work does not mutate the server. Exact-key repeats leave one child create, update and archive audit each; the record ends archived at version 3. This proves SDK create/update/archive lifecycle behavior. It does not yet prove every update/archive descendant combination in a rejected-command review.

Unit coverage includes durable restart/lookup, explicit retry targets, differing-input/dependency rejection, reviewed dependency remapping, update/archive bases and accepted receipts, revocation before acknowledgment, workspace isolation, hostile direct capture, malformed receipts, type narrowing and permission simulation. Existing signed-contract and recovery tests remain applicable.

## Verification notes

- Initial focused SDK/host/storage/UI compatibility run passed 73 tests across four files before the final additional cases.
- Initial command-to-resource browser journey and resource development preview passed together. Log: `/tmp/gabs-resource-queue-web-focused.log`.
- Expanded create/update/archive browser journey passed after its harness closed the still-open Saved commands dialog before navigating. The initial navigation timeout was a test issue; product checks were unchanged. Log: `/tmp/gabs-resource-lifecycle-web-final.log`.
- Strict checks and all four fresh production builds passed in `/tmp/gabs-resource-queue-final-build.log`. Later fixture/test-only changes passed strict checks in `/tmp/gabs-resource-lifecycle-types.log`.
- The first full regression attempt was interrupted with no completion result; its process handle was gone and no matching process remained. Its inactive isolated database was removed. It supplies no acceptance evidence.
- The completed broad regression passed 548 tests across 89 files. All six headless browser cases and five hidden/minimized, unfocused native cases passed, covering both continuation paths, queued capture/retry/revocation, workspace scheduling, previews and native stale-metadata recovery. Logs: `/tmp/gabs-resource-queue-regression-final.log`, `/tmp/gabs-resource-queue-web-acceptance.log`, `/tmp/gabs-resource-queue-native-acceptance.log`.
- Parent review then rejected ambiguous mixed command/resource identities in `isQueueCaptureError`. Strict checks/four fresh builds and all 550 unit/PostgreSQL tests across 89 files passed after that correction. Logs: `/tmp/gabs-resource-review-build.log`, `/tmp/gabs-resource-review-tests.log`.
- The subsequent [architecture review](../architecture/README.md#queued-resource-checkpoint-review-19-september-2026) aligned simulator/host request-key validation with their existing schema owners and records final affected checks. The broad browser/native run above preceded these validation-only corrections; it is not represented as a second final-source full run.
- All twelve wide/narrow web/native captures in this directory were inspected, including selected/unselected creates, reachable scrolled actions, revocation feedback and original/update comparisons. Text wraps within narrow dialogs; lower content and actions remain scrollable. These captures establish continuity, not final UI approval. No production stylesheet changed.

## Remaining scope

OFF-01 remains open: other custom/archive descendant combinations, submitted-child outcomes, source-schema/legacy recovery transitions and full scheduling simulation still require acceptance. OFF-02 working sets and OFF-03 profile/sign-out recovery remain separate. Provider, signed-release, broader product and UI-refinement gates are unchanged.
