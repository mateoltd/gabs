# Queued custom-operation foundation

OFF-01, 18 September 2026. This is SDK and storage implementation evidence. Custom-view host wiring, user-facing recovery and real web/native queued-command acceptance remain required.

## Contracts

`createModuleClient(module, transport, queueHost)` now exposes `queue(name, input, { key, dependencies })` and `queued(name, key)`. The operation name and input are inferred. Online commands, queries and service-only commands are excluded statically when their definition is literal and rejected at runtime. Existing `call` and `attempt` methods retain their accepted-result semantics.

A capture receipt contains the original identity, module version, input, prerequisites and a discriminated state. Only `accepted` carries the operation's inferred output. `pending` exposes unsubmitted/uncertain delivery. Rejected/conflicting results expose a message and code, plus a validated inferred business error when declared. A missing lookup returns `undefined`; a different original release requires that release's contract instead of interpreting output with a newer schema.

The SDK validates receipt identity, input, states, declared output and errors. Pending receipts cannot contain accepted values. Caller input is snapshotted before asynchronous capture. `QueueCaptureError` retains the generated identity when a durable commit may have succeeded but its reply cannot be confirmed. Callers must inspect or retry that identity, not create another key. `isQueueCaptureError` is a structural type guard for views that bundle a separate SDK copy; error-class identity is not assumed.

`createModuleQueue` binds storage to an account/workspace and receives a current-authority callback from its host. It rechecks access around capture/inspection. The shell has not yet supplied the policy/lease-aware adapter; this lower layer is not a replacement for server authorization or offline lease enforcement.

## Durable storage and synchronization

Capture validates the signed original operation, queued policy and input, commits it with its response contract, and never invokes network transport. Explicit command prerequisites are retained separately from dependencies derived from schema-declared resource references. Existing keys cannot be reused for different input or explicit prerequisites. Exact repeated capture returns the stored state, including acceptance, without appending an operation.

The existing journal records dispatch before sending, preserves uncertain identities after lost replies or subsequent denial, and lets unrelated work continue after a definitive rejection. Operation output and declared business errors now use the retained signed operation schema. A malformed response remains uncertain instead of masquerading as acceptance/rejection.

Original signed contracts remain retained for operation history, including accepted outcomes. Ordinary drafts and source recovery metadata also retain their referenced contracts when no pending journal requires them. Those packages can be collected when the owning history/drafts are explicitly retired; the existing journal retention/lifecycle work remains required.

## Verification coverage

Unit checks cover inferred contracts, policy rejection, original-release validation after upgrade, durable capture/reload, exact repeated capture, schema-derived dependencies, malformed output/error/host receipts, changed input/prerequisites, lost capture replies, interrupted storage, caller mutation, authorization changes and account isolation. Ordinary-draft schema retention has a regression check.

A PostgreSQL/API integration uses the actual installed Orders and Inventory releases. It creates a product, captures a typed Orders draft, loses the successful server reply, reconstructs the client against the stored journal, retries with the exact original key and verifies the same accepted output. The database contains one order, one creation audit and one receipt. Its client storage is an in-memory Platform fixture; this does not establish browser or SQLite process durability.

Final strict root/browser/Node/preload/worker checks, dependency/copy checks and all four production builds passed. Five headless browser recovery journeys and four hidden/unfocused Electron journeys passed against the shared storage changes. Those UI regressions ran before the final additive capture-error guard; their paths and UI sources are unchanged. The final full unit/PostgreSQL run passed **487 tests across 82 files**. All isolated databases were removed. Formatting and local evidence links passed; historical screenshot artifacts were restored to their committed bytes. Scoped keyboard/Axe/overflow assertions passed in the existing journeys; no new UI design is claimed. Logs: `/tmp/gabs-queued-foundation-build-final3.log`, `/tmp/gabs-queued-foundation-full-final.log`, `/tmp/gabs-queued-foundation-web.log`, `/tmp/gabs-queued-foundation-native.log`. Initial checks caught an internal optional-operation typing error and an incomplete integration Platform fixture; both were corrected. The initial integration database assertion used the public-resource name instead of the private `$orders` store; it was corrected to query the actual implementation, preserving the exact count assertions.

## Required continuation

- Wire a current-policy/lease-aware queue adapter into custom corporate views and advertise an explicit host contract so new packages cannot run on an incapable host.
- Route operation journals through the operation endpoint during synchronization, with current original/current release permissions and correct handling of unrelated workspace entries.
- Provide durable discovery and recovery of saved command identities, including visible pending/accepted/rejected/conflict states, retry, authoritative settlement, explicit correction and saved-input inspection.
- Verify real custom views through offline capture, browser reload/native process restart, reconnect, lost replies, revocation/lease expiry, upgrades and duplicate-free server effects.
- Complete custom/archive descendants, submitted-child outcomes, permanent revocation, broader profile/release acceptance and the other OFF-01 gates. The earlier intermittent linked-create dialog-close concern remains unchanged.

No UI/style source changed in this foundation. OFF-01 and full parity remain active; this is not final UI approval or completion of queued custom-operation workflows.
