# Queued custom operations

OFF-01, 18 September 2026. SDK/storage foundation and scoped custom-view browser/native acceptance are verified. Explicit correction, wider dependency recovery and the additional gates below remain required.

## Contracts

`createModuleClient(module, transport, queueHost)` now exposes `queue(name, input, { key, dependencies })` and `queued(name, key)`. The operation name and input are inferred. Online commands, queries and service-only commands are excluded statically when their definition is literal and rejected at runtime. Existing `call` and `attempt` methods retain their accepted-result semantics.

A capture receipt contains the original identity, module version, input, prerequisites and a discriminated state. Only `accepted` carries the operation's inferred output. `pending` exposes unsubmitted/uncertain delivery. Rejected/conflicting results expose a message and code, plus a validated inferred business error when declared. A missing lookup returns `undefined`; a different original release requires that release's contract instead of interpreting output with a newer schema.

The SDK validates receipt identity, input, states, declared output and errors. Pending receipts cannot contain accepted values. Caller input is snapshotted before asynchronous capture. `QueueCaptureError` retains the generated identity when a durable commit may have succeeded but its reply cannot be confirmed. Callers must inspect or retry that identity, not create another key. `isQueueCaptureError` is a structural type guard for views that bundle a separate SDK copy; error-class identity is not assumed.

`createModuleQueue` binds storage to an account/workspace and receives a current-authority callback from its host. It rechecks access around capture/inspection. The shell now supplies the policy/lease-aware adapter described below; this lower layer is not a replacement for server authorization or offline lease enforcement.

## Durable storage and synchronization

Capture validates the signed original operation, queued policy and input, commits it with its response contract, and never invokes network transport. Explicit command prerequisites are retained separately from dependencies derived from schema-declared resource references. Existing keys cannot be reused for different input or explicit prerequisites. Exact repeated capture returns the stored state, including acceptance, without appending an operation.

The existing journal records dispatch before sending, preserves uncertain identities after lost replies or subsequent denial, and lets unrelated work continue after a definitive rejection. Operation output and declared business errors now use the retained signed operation schema. A malformed response remains uncertain instead of masquerading as acceptance/rejection.

Original signed contracts remain retained for operation history, including accepted outcomes. Ordinary drafts and source recovery metadata also retain their referenced contracts when no pending journal requires them. Those packages can be collected when the owning history/drafts are explicitly retired; the existing journal retention/lifecycle work remains required.

## Verification coverage

Unit checks cover inferred contracts, policy rejection, original-release validation after upgrade, durable capture/reload, exact repeated capture, schema-derived dependencies, malformed output/error/host receipts, changed input/prerequisites, lost capture replies, interrupted storage, caller mutation, authorization changes and account isolation. Ordinary-draft schema retention has a regression check.

A PostgreSQL/API integration uses the actual installed Orders and Inventory releases. It creates a product, captures a typed Orders draft, loses the successful server reply, reconstructs the client against the stored journal, retries with the exact original key and verifies the same accepted output. The database contains one order, one creation audit and one receipt. Its client storage is an in-memory Platform fixture; this does not establish browser or SQLite process durability.

Final strict root/browser/Node/preload/worker checks, dependency/copy checks and all four production builds passed. Five headless browser recovery journeys and four hidden/unfocused Electron journeys passed against the shared storage changes. Those UI regressions ran before the final additive capture-error guard; their paths and UI sources are unchanged. The final full unit/PostgreSQL run passed **487 tests across 82 files**. All isolated databases were removed. Formatting and local evidence links passed; historical screenshot artifacts were restored to their committed bytes. Scoped keyboard/Axe/overflow assertions passed in the existing journeys; no new UI design is claimed. Logs: `/tmp/gabs-queued-foundation-build-final3.log`, `/tmp/gabs-queued-foundation-full-final.log`, `/tmp/gabs-queued-foundation-web.log`, `/tmp/gabs-queued-foundation-native.log`. Initial checks caught an internal optional-operation typing error and an incomplete integration Platform fixture; both were corrected. The initial integration database assertion used the public-resource name instead of the private `$orders` store; it was corrected to query the actual implementation, preserving the exact count assertions.

## Custom-view host acceptance

The corporate custom-view host now supplies `client.queue` and `client.queued` through scoped persistent storage. Capture and lookup require an active view, its permission, the command permission, ready module dependencies, device storage consent and a current connected policy or unexpired offline snapshot. Closing a view or observing revoked permission removes access to saved input without discarding the journal. Server validation remains authoritative.

A shared transport routes resource requests, queries, references and commands to their respective endpoints while preserving the original module version, body, retry identity and abort signal. Both custom and generated views use it. Synchronization skips ineligible entries without treating them as rejected or blocking independent work; authority is rechecked after asynchronous contract verification and before network dispatch.

The host-owned Saved commands dialog exposes provisional, accepted, rejected/conflict and uncertain states, original input, verified accepted output, delivery details, exact-key retry and explicit authoritative outcome resolution. Resolving an uncertain command can recover its accepted receipt or fence an uncommitted request. This milestone proves the accepted-receipt branch in real clients; it does not claim an arbitrary-command correction editor or complete cancelled-command recovery.

Newly built views for modules exposing queued commands require `client.queue` revision 1. Hosts advertise it only when supplying the adapter. Historical signed packages are unchanged. The SDK simulator and development preview provide the same typed capture/lookup contract over an explicitly in-memory journal, with explicit prerequisites and permission simulation; this is development support, not durability evidence or complete simulation of production reference-derived scheduling.

### Implementation and acceptance sources

- [Custom-view queue and inbox](../../../packages/shell/src/features/modules/views/queued-commands.tsx), [shared transport](../../../packages/client/src/modules/transport.ts), [journal eligibility](../../../packages/sdk/src/contracts/sync.ts).
- [Host contract and simulation checks](../../../tests/unit/queued-host.test.ts), [shared real-client journey](../../../tests/support/queued-commands-journey.ts), [browser and preview runner](../../../tests/e2e/queued-commands.spec.ts), [native restart runner](../../../tests/desktop/queued-commands.spec.ts).

### Verification

- `pnpm build` passed strict root/browser/Node/preload/worker checks, architecture/copy checks and all four fresh builds. Existing bundle-size warnings remain. Final log: `/tmp/gabs-queued-host-build-final2.log`.
- Full isolated PostgreSQL/unit run passed **491 tests across 83 files**. `/tmp/gabs-queued-host-full.log`.
- Four distinct headless browser journeys passed: custom queued commands, queued development preview, existing preview reload/simulation and independent saved reviews. The initial combined run passed three and failed because the new test tried to uncheck a control inside a collapsed disclosure; opening that disclosure fixed the test, and both queued journeys passed the rerun. Logs: `/tmp/gabs-queued-host-web-final.log`, `/tmp/gabs-queued-host-web-rerun.log`.
- Two hidden/unfocused Electron journeys passed: queued commands and independent saved reviews. The first native attempt reached offline restart but used Axe's unsupported extra-page mode; the established Electron legacy mode fixed the harness. Final log: `/tmp/gabs-queued-host-native-final.log`.
- The independently signed fixture proves three offline captures survive browser reload/native process restart with unchanged bodies and keys. Lost-reply retries produce exactly two records and two resource audits while one declared business rejection remains inspectable. A fourth capture loses its accepted reply and resolves through the server settlement endpoint, yielding exactly three records/audits overall. Connected command-permission revocation disables capture and hides saved input while retaining all four entries.
- Scoped Axe, keyboard disclosure/Escape interaction and narrow overflow checks passed. Four wide/narrow web/native captures were inspected. The existing modal, controls and schema-value renderer are reused; no stylesheet changed. Eight historical regression captures were restored.

## Required continuation

- Explicit correction of rejected/conflicting/cancelled commands, with current-schema validation, preserved original input and safe prerequisite handling. Never rekey an uncertain request automatically.
- Real custom-command uncommitted-outcome fencing, lease expiry during held actions, profile/sign-out recovery, release upgrades and original/current permission transitions.
- Custom/archive descendants, already-submitted child outcomes, permanent revocation, journal retention/large histories and remaining OFF-01 gates. Extend simulation of derived references and dependency recovery alongside those contracts.
- The earlier intermittent linked-create dialog-close concern remains open. Full parity, signed/provider release acceptance and final UI refinement remain separate requirements.
