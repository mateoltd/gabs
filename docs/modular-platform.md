# Modular platform implementation

This document describes implemented behavior, not a production-release claim. The [requirement ledger](requirement-ledger.md) identifies the remaining work against the complete approved plan and all 29 original specification IDs.

## Runtime

React and TypeScript run in the web client and Electron renderer. Corporate writes execute in the Fastify/PostgreSQL host. The PostgreSQL transaction includes authorization, business changes, history, audit, idempotency results and outbox events. No desktop peer can finalize a corporate write.

- `packages/sdk`: authoring, runtime schema validation, inferred clients, typed server handlers, dependency resolution, policy calculation and journal protocol.
- `composition`: generated discovery of module definitions and reviewed server entry points. Browser imports do not include server code.
- `apps/api/src/platform.ts`: generic resources, typed business operation dispatch, organization policy, installation and artifact delivery.
- `packages/server/src/module-runtime.ts`: workspace-scoped resources, revisions, conflict merging and reference grants.
- `packages/shell/src/module-view.tsx`: generated resource screens with forms, search, pagination, archive and provisional changes.
- `modules/contacts`, `modules/projects`: declarative applications with generated screens. Orders and Inventory use scoped SDK handlers with private stores and declared cross-module services, while retaining their richer existing screens.

### Authoring

```ts
import { defineModule, resource, field, Type } from "@suite/module-sdk";

export default defineModule({
  id: "equipment",
  name: "Equipment",
  version: "1.0.0",
  description: "Office equipment register",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  permissions: ["equipment.items.read", "equipment.items.write"],
  configuration: Type.Object({}, { additionalProperties: false }),
  operations: {},
  navigation: { path: "/equipment", permission: "equipment.items.read" },
  resources: {
    items: resource(
      {
        name: field.text({ minLength: 1 }),
        state: field.enum(["available", "assigned"]),
      },
      { title: "Equipment", policy: "queued", standalone: true },
    ),
  },
});
```

`client.module(definition, workspaceId).resource('items')` infers field names, required fields and enum values. It exposes list/get/create/update/archive. `client.module(definition, workspaceId).call(name, input, idempotencyKey)` infers operation input and output. Persist a key for an uncertain retry. Runtime schemas validate untrusted inputs regardless of TypeScript types.

For custom corporate operations, define schemas with `operation` and add a reviewed `module-server.ts` using `defineModuleServer(definition)({...handlers})`. Handlers receive inferred configuration, own-module resource repositories, declared events, permission checks and explicitly declared service calls. They do not receive a database transaction. `context.reject(error)` validates the operation's declared business-error schema; `client.attempt(name, input, key)` returns a typed success/error union. Authentication and transport failures still throw.

Use `ctx.serviceAttempt(name, input)` to inspect a provider's declared error and translate it with `ctx.reject(...)`. Its success value and error are inferred from the service contract. A rejected child still aborts the entire transaction even if the handler ignores that result; authorization and grant failures continue to throw.

Declare a provider operation with `public: true`; use `serviceReference(provider, "operation")` in a consumer's `services` map and declare the provider dependency. An administrator separately grants each public service under module configuration. The host rechecks actor permissions, activation, assignment, grant and exact service contract on every call. Custom events use `module.<id>.event.<name>` to avoid collisions with host events. All records, audit entries, outgoing events and the outer idempotency receipt share one transaction. A caught failed capability call still aborts the transaction; detached capability calls are drained before commit. Service recursion is bounded and cyclic calls fail.

Set `serviceOnly: true` alongside `public: true` when only declared module consumers may invoke an operation. Direct clients are denied, including saved-receipt replay. The provider receives the immutable, host-supplied `ctx.caller` (`moduleId` and `operation`) for ownership checks. This identity never replaces the actor's permissions or the separate service grant.

Declare module-local actions such as `audit: ["order.confirmed"]`; `await ctx.audit("order.confirmed", orderId)` infers the action name and writes an audit prefixed by the module ID. Audit calls are server capabilities and share the operation transaction. Invalid caught or detached audit calls still abort it.

Default Orders and Inventory 2.0 releases use scoped SDK capabilities. New workspaces initialize their empty schema-2 namespaces with an auditable trusted onboarding template, including reviewed cross-module service grants. Archived Inventory 1.2 and Orders 1.1 trusted bridges remain for existing schema-1 workspaces and historical receipt recovery until reviewed conversion. [Default release acceptance](verification/business-defaults/README.md) covers fresh web/native journeys, role permissions and storage boundaries. Trusted official code is not a hostile-code sandbox.

Export an exact typed provider contract into the consumer package:

```sh
pnpm module services ./modules/inventory/releases/2.0.0 modules/orders/releases/2.0.0/inventory-services.ts --check
pnpm module build ./modules/orders/releases/2.0.0 --dependency ./modules/inventory/releases/2.0.0
```

Omit `--check` when creating a new snapshot; use `--update` to explicitly regenerate an existing one after reviewing provider changes. Generated references retain input/output/error types and include only public services. Declare the dependency and request separate administrator service grants. Unsupported schema shapes fail with a field path. Build dependency directories can be supplied repeatedly; neither exporting nor building publishes a release.

### Read-only operations

Declare `kind: "query"` with `policy: "online"` for an authoritative read:

```ts
summary: operation({
  kind: "query",
  policy: "online",
  title: "Read summary",
  permission: "example.read",
  input: Type.Object({}),
  output: Type.Object({ count: Type.Integer() }),
}),
```

`client.call("summary", {})` infers the same input/output/error types as commands and automatically uses `/api/v1/module/{module_id}/workspaces/{workspace_id}/queries/{operation_name}`. Web and bounded Electron transports carry the signed module version. Queries use POST for validated structured input but create no idempotency receipts or operation audits; a supplied request key does not cache their result. Responses carry `Cache-Control: no-store`. Offline cache access remains a separate working-set capability, not a queued query.

A query handler receives only reads from its resources/private stores and declared query services. Types reject mutation methods, record locks, events, audits and calls to command services. The host enforces these restrictions even when module code bypasses TypeScript; caught or detached violations still fail the transaction. Read-only contracts require a scoped backend.

Each top-level query executes with fresh request authorization in one PostgreSQL repeatable-read, read-only transaction. Related reads and query-service calls see that request's snapshot. Accepted older contracts also require the current operation's permission, query kind and direct-call visibility. Calls from a command into a query service retain the command's transaction/isolation; the query service still cannot write. An authorization change committed after a query snapshot starts affects subsequent requests.

A new HTTP page is a new snapshot. Paginating an export across requests does **not** freeze its contents; the worker's eventual complete export must run all its pages in one authorized snapshot transaction. Existing operations without `kind` remain commands, including locking product-resolution services.

### Private transactional stores

Use `store` for server-owned data that should not have generated public CRUD. Declare it once alongside resources and operations:

```ts
stores: {
  balances: store(
    { sku: Type.String(), units: Type.Integer({ minimum: 0 }) },
    { unique: ["sku"] },
  ),
}
```

An operation handler can read `await ctx.store("balances").get(id, { lock: true })`, validate its business rule, and call `replace(id, current.version, nextData)`. The row lock lasts until the entire operation and its service calls commit or roll back. Acquire multiple record locks in a consistent order. An absent or archived record returns `null`; a logical ID lock also protects first-time creation after a locked absent read. UUID casing does not change lock identity. Stale versions fail rather than overwriting current data.

`scan({ where, after, limit })` infers its filter fields and returns `{ items, next }`. Filters use JSON containment; scalar values match exactly. Pages default to 50 records and cannot exceed 200. `create(data, { id? })` returns `{ id, data, version }`; `archive(id, version)` retains the data and history. Unique fields are scalar, independent constraints scoped to that module/workspace/store; missing values do not conflict. A record is limited to 1 MiB.

Use `query` for richer bounded reads and `aggregate` for complete totals:

```ts
const page = await ctx.store("balances").query({
  search: { fields: ["sku"], text: "SUPPLY" },
  ranges: { units: { gte: 1 } },
  orderBy: [{ field: "units", direction: "asc" }],
  limit: 50,
  cursor,
});
const totals = await ctx.store("balances").aggregate({ sum: ["units"] });
```

Search/range/sort/sum fields and aggregate results are inferred. Queries allow up to eight search/range fields, three scalar sort fields and 200 rows per page. Strings sort by byte order, numbers numerically, missing values last, with record IDs breaking ties. Search is a literal case-insensitive substring, using the database locale. `aggregate({ groupBy, sum, maxGroups })` returns complete `{ count, sums, groups }`; more than 200 groups or unsafe integer totals fail explicitly. `scan` retains its original UUID `after` convention; `query` returns encrypted `next` tokens for its `cursor` parameter.

Configure the shared production `MODULE_QUERY_CURSOR_KEY` secret on API/worker instances. Tokens hide sort values and bind their query/account/workspace scope. Development can use process-local keys; restart or key rotation requires a fresh list query. Cursors preserve an archived anchor's sort position, but do not create a snapshot across separate requests. [Detailed acceptance and remaining read-dispatch work](verification/store-queries/README.md).

Private-store access is authorized by the enclosing operation. The module cannot select another workspace or module. Cross-module reads and effects require public services and explicit grants. Store data and commands receive server validation even when callers bypass TypeScript. All writes and their audits participate in the existing atomic operation and idempotency mechanism.

Reviewed migrations use `ctx.store(name).scan/create/write/archive` with historical data typed as unknown records. The host validates retained data against the target schema and rejects duplicate unique values before publishing the new stored schema version. Use a forward storage migration when changing stored data contracts. These capabilities require a server transaction; they are not an implementation of standalone local workers. [Verification and remaining migration work](verification/private-stores/README.md).

```sh
pnpm module create equipment
pnpm install
pnpm module check equipment
pnpm module dev equipment
pnpm module test equipment
pnpm module build equipment
pnpm module inspect .local/modules/equipment-1.0.0.json
pnpm module submit .local/modules/equipment-1.0.0.json
pnpm module console # inspect, approve and publish the submission
```

Scaffolding creates the manifest, example fixture, package and module-owned scenarios. `check` validates the module source graph, dependencies, custom client bundles and fixture schemas with resource/index diagnostics. `test` runs the selected module's own typed `module.scenarios.ts`, with fresh simulation state and named failures; missing scenarios fail. Both commands accept an independent module directory and repeated `--dependency <provider-directory>` arguments without catalog changes. See the [scenario authoring guide](module-scenarios.md). `dev` accepts a discovered module or independent directory and starts a loopback-only developer workspace at http://127.0.0.1:4321 (override `MODULE_DEV_PORT`). It renders manifest custom React views through the public host UI kit, generates input forms, previews accepted records, simulates connectivity and permissions, and displays provisional/accepted/rejected journal entries and emitted events. Source, custom view, CSS, configuration and fixture changes restart and reload the isolated simulation; fixtures and simulated changes reset. Build diagnostics remain visible until corrected, and stale requests cannot mutate a replacement simulator. See the [development preview guide](module-development.md). The `@suite/module-sdk/simulator` adapter supports typed fixtures and direct tests. It does not use corporate data. Cross-module provider integration, historical merge behavior and real persistence require the PostgreSQL/browser tests; the simulator is not evidence of server correctness. Newly published releases load without an API restart. Neither a central module union nor a host route edit is needed. Modules with operations or storage migrations require an independently signed, reviewed server package staged through the registry before publication.

**Simulation scheduling.** Typed simulated queues and preview offline submission use the portable host ordering rules from `@suite/module-sdk/sync/order`. Captures retain explicit prerequisites and derive same-record/nested-reference dependencies; cycles fail before journal mutation. Exact retries compare the originally requested prerequisite set independently of order. Conflicts hold dependent work without blocking unrelated records. See [scoped scheduling acceptance](verification/simulation-order/README.md); the in-memory simulator does not establish production durability or server correctness.

**Offline policy and saved work.** Administrators can disable corporate offline access or choose an integer 1–24-hour window. Received policy is reconciled with persisted snapshots under the account/workspace lock; stale snapshot writes retain the newer policy. Disabling access expires the local lease without deleting device consent or pending work. Connected, currently authorized recovery and synchronization remain available, while new queued captures require enabled offline policy. Removing device data still refuses unresolved drafts/changes. See [policy recovery acceptance](verification/offline-policy/README.md); membership/profile revocation and broader context transitions retain their own gates.

**Received membership denial.** A scoped policy session persists a new authorization generation before expiring its snapshot, retaining the device preference and pending work. Requests begun before denial and stale snapshot writers cannot restore that generation. Same-account/workspace tabs receive a revocation notification and hide retained surfaces. Only fresh online authorization restores access; a denied marker also locks a snapshot after an interrupted expiry write. Session-only online use creates no implicit cache or storage requirement. [Scoped acceptance](verification/policy-revocation/README.md) does not establish account-wide cookie/profile transitions or native protected-storage recovery.

**Downloaded page retention.** Generated corporate resource views keep at most 50 downloaded query pages within a 5 MiB serialized UTF-8 page-entry budget per account/workspace. Named offline lists save the current filters and a bounded multi-page selection; users can open, refresh or remove them. Selected pages take priority over recent automatic caching. Oversized selected refreshes preserve the prior download and timestamp. Recent-page cleanup keeps selections; Settings can explicitly clear all downloaded lists/pages while retaining drafts, requests, reviews and execution contracts. Offline views show their download time or report it unavailable. Missing or evicted queries require reconnecting. See [selected-list evidence](verification/offline-lists/README.md); this is not a total workspace-storage quota. Native acceptance, custom-view SDK cached reads and reference-cache management remain required.

`module create` runs discovery first and then asks for `pnpm install`; that install creates the new bare-package link used by composition. When adding or removing a module directory manually, run `pnpm modules:discover` and then `pnpm install` before typechecking or building. On a fresh checkout, the generated catalog and composition manifest are already committed, so one `pnpm install` creates every required link before `pnpm build`. Discovery owns only the module dependencies listed in `composition/package.json` under `suite.generatedModuleDependencies`; it removes stale generated entries while preserving hand-owned composition dependencies.

`pnpm db:seed` creates development-only signing keys and signs the four official definitions. For a separate trusted publisher environment, `pnpm module keygen` creates a new key pair once. Existing private keys are never overwritten. Private keys and built artifacts live under ignored `.local/`. Production requires operator-managed trust keys and signing/release procedures.

### Trust and installation

Packages contain canonical JSON metadata, SHA-256 digest, Ed25519 signature and signing-key fingerprint. The resolver honors exact workspace pins and host/backend/dependency ranges. Publication is immutable for a module/version; changed content requires a new version.

Entitlement, organization activation, membership assignment, device installation and runtime availability are separate. The Modules screen verifies signatures, downloads dependencies, configures and publishes modules, manages grants and pins, repairs installations, and uninstalls without deleting business records. Verified package downloads and exact install/removal attempts survive interruption. The previous local installation remains until every replacement verifies and the server acknowledges that exact selection. A durable request ID and server receipt recover lost replies and failed local commits without duplicate effects. [Device lifecycle recovery](module-lifecycle-recovery.md) documents the protocol and browser/native evidence.

Assigned, entitled, published modules install in the background on the next authorization/catalog refresh, without first opening their screen. Approval propagation is currently polled, not pushed. Cancelling the active workspace prevents remaining background installation steps. Explicitly uninstalled modules require manual reinstall. Web/desktop module entry checks verified installation state. Configuration and suspension remain authoritative server checks on every operation. A disconnected client cannot discover a new suspension before its lease expires.

The registry distributes signed contracts, custom React bundles and scoped server artifacts. The [protected operator workflow](module-server-releases.md) submits, reviews, stages and publishes official releases. Exact reviewed backend versions coexist and dispatch against the workspace's selected signed contract. [Per-module storage migrations](module-storage-migrations.md) preserve data on failure and restrict executable rollback to compatible schemas. Interrupted update/repair and schema-safe rollback have local acceptance. Mandatory rollout and hosted trust-rotation acceptance remain open. The fifth-module proof covers independent reviewed executable loading; it is not a hostile-code sandbox. External publisher onboarding remains future scope.

### Coordinated Orders and Inventory upgrade

While a workspace uses the historical business storage, administrators use **Modules → Upgrade business modules** to select published schema-2 releases, explicitly add introduced role permissions and grant the required Inventory services. **Review upgrade** is read-only and checks releases, staged backends, current access, configuration and source consistency. Resolve reported access/denial issues before applying. A changed policy invalidates the review.

**Apply reviewed upgrade** commits selected permissions, service grants and both data migrations together, makes the selected client releases mandatory, and preserves source history. Failed conversion rolls everything back. After an uncertain response, **Retry upgrade** reuses the exact request; reloading also retrieves the durable completion state. Old clients must update and cannot commit against preserved source tables. Offline cached access lasts only through the existing lease. See [acceptance and limits](verification/business-cutover/README.md). New workspaces already use these scoped defaults; existing schema-1 workspaces require this explicit administrator upgrade. Production onboarding still requires entitlements and publication before runtime availability.

## Offline and local work

Corporate offline access defaults to a maximum 24-hour authorization lease. Administrators can shorten it or disable it. Devices opt in before persisting corporate records. The web uses IndexedDB; Electron stores AES-256-GCM encrypted record payloads in SQLite in a utility process, with the master key wrapped by OS credential storage. SQLite record keys and database metadata are not encrypted; this is not SQLCipher or a claim of full-file encryption.

The journal stores stable operation IDs, inputs, base versions, dependencies and pending/accepted/rejected/conflict states. The server reloads the historical base to merge disjoint edits. It never trusts a client-supplied base image. Conflicts retain provisional contents for review; dependency failures do not block unrelated entries. A transport failure, HTTP 408 or server error leaves that request uncertain while allowing other eligible requests one attempt in the current pass. Authentication, membership/MFA failures and HTTP 429 stop the pass; current authority and connectivity still govern each dispatch. A revoked membership clears cached readable pages and locks access while preserving the journal for authorized recovery. Lease expiry does not delete pending work. Explicit sign-out currently removes local corporate data and is identified in Settings; a richer recovery/export flow remains necessary.

Standalone profiles use a separate encrypted IndexedDB vault with AES-GCM and a PBKDF2-derived key. They can create/edit supported local resources, lock, unlock, export and remove a profile. Backgrounding locks the local profile. Local authority is indefinite and separate from company records. Native biometric unlock, saved online-profile management and validated company import remain unfinished. Standalone record writes now run in a dedicated worker and commit their data plus retry receipts atomically to the encrypted profile; concurrent sessions use revision checks.

`@suite/module-sdk/local` exposes `defineLocalModule(module)({ ...handlers })` and `createLocalModuleClient(module, transport)`. Only operations with `policy: "local"` belong in `module-local.ts`; `defineModuleServer` handles corporate operations. Handler context supplies `profileId`, `requestId`, configuration, typed standalone resources, explicitly granted local `service`/`serviceAttempt` calls and `reject`, without corporate authority or unrestricted device access. Typed `ctx.device.request(alias, input)` commits a [device request](local-device-requests.md) with records; its returned ID is pending, not proof of an external effect. [Standalone service composition](local-services.md) documents exact-version consent, caller context and atomic multi-module recovery. Reviewed bundled handlers are discovered into a worker-only catalog. The CLI bundles `module-local.ts` into signed `suite-local-v2` artifacts; retained v1 releases remain supported. Local-only releases use the normal review/publication workflow without server staging; mixed corporate operations and migrations still require a server. `LocalSession.install(package, trustedRegistryKey, configuration)` preflights signed code in a worker, checks dependencies and retained data, then commits the selected release into the encrypted profile. Compatible upgrades retain historical receipts and releases; new calls must use the active version. `uninstall(moduleId)` preserves records and refuses active dependents. The registry key must come from the trusted host, never the package itself. Personal schema changes use the reviewed `localStorage` migration path described below; missing paths and incompatible rollback are refused without changing the current installation. Open Local profiles from the account menu, then Manage local modules to install an authorized standalone release from the personal registry. Configuration remains local; company records and settings are not imported. Local actions derives forms from operation inputs and exposes cancellation plus pending/rejected/interrupted/accepted requests. Before custom operation execution, the host encrypts the exact request, release and configuration; accepted changes and receipts commit atomically. `LocalSession.retry(attemptId, { signal })` recovers the saved request and `dismiss(attemptId)` removes its recovery entry without removing records or receipts. Incompatible configuration/release changes are blocked while unresolved requests remain. Installation attempts are saved before execution and recoverable after restart. Coordinated local dependency updates now use one reviewed installation set; local-profile fleet reporting remains open. Removed modules can be restored offline from their retained signed release through **Restore locally**. See [interface recovery acceptance](verification/local-controls/README.md). See [independent local executable acceptance](verification/local-executables/README.md). Use a stable key when retrying `LocalSession.execute`; records and results share one durable transaction. Cancellation before commit discards the worker result; once commit has begun, retry after unlock recovers its outcome. See [acceptance and limits](verification/local-worker/README.md).

### Cached reads in custom views

The corporate host’s typed `client.resource(name).list(query, options)` and `.get(id, options)` use the authoritative server while connected. With device consent and a current workspace lease, completed reads are saved in the same disposable cache used by generated views. Offline list reads require the exact downloaded release/resource/query, including pagination. A record read can use a complete row from any downloaded page of that exact release/resource; the highest downloaded record version wins, then the latest known download time. Individual online record reads consume one slot in the shared 50-entry/5 MiB page-entry budget. Selected lists retain their existing priority. No pending edit is overlaid onto these server-derived results.

Read methods return `ResourceRead<ResourcePage<Data>>` or `ResourceRead<ResourceRecord<Data>>`. The optional `read` metadata is `{ source: "server" }` or `{ source: "cache", downloadedAt: number | null }`; an absent source or null download time is unknown. `useResourceList` preserves this type. The host sets provenance itself and displays a persistent freshness notice when a custom view has consumed downloaded data. Online server failures are returned to the caller, without substitution of a cached success.

```ts
const notes = client.resource("notes");
const page = await notes.list({ search: "Office", limit: 10 });
if (page.read?.source === "cache") {
  // Display page.read.downloadedAt, allowing for an unknown timestamp.
}
const current = await notes.get(id, { source: "server" });
```

`source: "server"` requires a verified server-source response; offline, local, simulation or source-unknown transports cannot satisfy it. The server-only read contract started with `client.resources` revision 5; new builds now declare revision 6, including reference reads, so older hosts reject them before view initialization instead of ignoring this option. Existing revisions remain supported. A current server read never authorizes a later business commitment: the server still validates each write. Reference lookup and operation policies are unchanged by this read contract.

The host checks current view/resource permissions, scope, installed view identity, cancellation and offline consent/lease before returning cached data, including after asynchronous reads. It validates cached resource schemas again. Missing downloads, revoked access, expiry and incompatible releases are failures. Download clearing/removal affects only disposable records, preserving the separate journal and saved work. [Acceptance evidence](verification/resource-reads/README.md) distinguishes browser verification from pending protected native acceptance.

### Downloaded reference labels

Generated forms and public SDK reference clients use a shared cache of authorized labels. Offline search and paging cover the downloaded subset, with the selected identifier retained when its label is missing. The cache is bounded per account/workspace to 50 source/target buckets, 2,000 labels, 200 labels per bucket and a 1 MiB UTF-8 entry budget. This is separate from the downloaded record-page budget and from pending work. Historical oversized caches migrate under the storage lock; timestamps stay attached to individual labels rather than being renewed by unrelated lookups.

`client.resource(name).references(query, options)` returns `ReferenceReadPage`, including optional `read` provenance and an `offline` marker for downloaded results. The same metadata survives `loadReferences` and drives host picker freshness. `source: "server"` requires server provenance. Current bundles declare `client.resources` revision 6; older host revisions are rejected before module initialization, while the current host retains support for existing bundles.

Current source/target permissions and the offline lease govern every lookup. Cross-module cached choices additionally require successful lookup evidence for the current received policy revision; absent or outdated evidence requires reconnecting. Server denials discard the affected target’s labels, and changes of picker authority immediately hide its old labels without erasing the selected ID. Pending reference choices remain provisional journal projections and are never persisted as downloaded labels. Settings can clear labels independently of record pages, drafts and queued work. Clearing does not disable future authorized downloads. [Acceptance evidence](verification/reference-cache/README.md) distinguishes browser verification from the pending protected native gate.

### Standalone reference consent

Use **Manage local modules → Reference access** to permit declared cross-module resource references. `localReferenceAccess(session.data)` lists eligible consumer/provider/resource choices and their effective consent. `await session.setReferenceAccess(consumerId, providerId, resource, allowed)` durably saves or revokes the profile owner's decision. Refresh the current data/reference loader after it resolves; a pending decision is not accepted access.

Consent defaults to denied and binds both exact releases. Both modules must be available, the consumer must declare a compatible provider dependency, and the target must be standalone with a declared resource read permission. Either update requires renewed consent; uninstall clears related grants but preserves records. The host supplies only granted snapshots from that profile and the worker verifies provider contracts. Locking or another window changing/removing the profile causes requests to fail until unlock; no corporate permissions or data are imported. Reference grants support reference reads and ordinary linked resource edits. Cross-module business calls use separate [service grants](local-services.md); device effects remain unavailable in standalone handlers. The installer now reviews prospective exact-release grants for migrations introducing new foreign links. See [acceptance and limits](verification/local-reference-grants/README.md).

`localReferenceAccess(session.data, proposedModules)` previews the complete candidate installation without mutating the profile. The host exposes unchecked reference choices for affected consumer/provider releases. Pass explicit `LocalReferenceSelection` entries through `LocalInstallOptions.referenceGrants` to `install`, `installSet` or `installDownload`; each entry identifies the consumer ID/version, provider ID/version and resource. The installer verifies packages and validates every choice against the complete proposed dependency set. This preview is not an authorization token.

Consent is encrypted with the unfinished installation and becomes an active grant only in the same durable commit as every selected release and migrated record. Provider migrations run first, so final consumer validation can reference newly migrated provider records. Failure preserves previous releases, records, receipts and effective grants. `retryInstallation` uses the saved choices and revalidates them; changing an unfinished selection requires discard and review. Explicit revocation removes matching pending choices too, preventing retry from restoring revoked access. The recovery panel shows the approved module names, versions and resource. See [installation grant acceptance](verification/local-migration-grants/README.md).

### Personal schema migrations

Declare `localStorage` separately from corporate `storage`. It defaults to version 1 and uses the same forward-only version/compatibility contract. Each declared step requires a handler in `module-local.ts`, even when there are no custom operations:

```ts
// In the module definition:
localStorage: {
  version: 2,
  compatible: { minimum: 2, maximum: 2 },
  migrations: { rename: { from: 1, to: 2 } },
}

// In module-local.ts, after importing the definition and defineLocalModule:
export default defineLocalModule(module)({}, {
  rename: async (ctx) => {
    let after: string | undefined;
    do {
      const page = await ctx.resource("notes").scan(after);
      for (const row of page.items) {
        if (typeof row.data.text !== "string")
          throw Error("The existing note has invalid text.");
        await ctx.resource("notes").write(
          row.id, { body: row.data.text }, row.version,
        );
      }
      after = page.nextCursor ?? undefined;
    } while (after);
  },
});
```

`scan` includes archived records in pages of 100, ordered by record identifier. Historical fields remain unknown until checked. Handlers can create derived records, write or archive records with version checks, or rename a historical resource to a declared standalone target. Access is restricted to the module's profile snapshot; no corporate or privileged desktop context is provided. Handler names, configuration and rename targets are inferred from the public contract. Caught capability errors and detached writes cannot escape transaction validation.

`LocalSession.install(package, trustedRegistryKey, configuration, { signal, timeoutMs })` executes the signed path in a disposable worker, validates every resulting record, then atomically saves the release, records, schema version and migration history. Cancellation, worker failure, missing migration paths and competing profile changes preserve the previous installation. Fresh empty installations start at the release's target schema. Historical retry receipts are retained unchanged. Executable rollback requires the stored schema to fall within the older executable's declared compatibility range and all retained records to validate; data is never downgraded. See [migration and offline restoration acceptance](verification/local-migrations/README.md).

Final validation includes annotated record links. The worker verifies the previous installed contract and compares final links with their original record/resource/field identity. Existing archived links can survive; new links, changed annotations and copied links require valid final targets. Intermediate migration writes cannot establish a historical exemption. Targets created later in the same migration are valid at the final check. Missing source evidence causes full revalidation. See [standalone reference reconciliation](module-references.md#standalone-migrations) and its [acceptance evidence](verification/local-migration-references/README.md).

Before migration begins, the verified package, trust key and configuration are encrypted into a stable installation attempt. `LocalSession.retryInstallation(attemptId, { signal, timeoutMs })` resumes the exact candidate offline and rechecks current profile constraints. The acceptance marker commits with the executable and migrated data, so retrying an accepted attempt cannot reinstall an older release. `dismissInstallation(attemptId)` removes a recovery entry without deleting the installed module or records. The local module dialog exposes pending/interrupted/failed attempts, resume, cancellation and explicit discard. See [installation recovery acceptance](verification/local-install-recovery/README.md). Interrupted network transfers before staging still require another download. Coordinated dependency updates use the atomic set API below. Partial-download recovery and profile fleet reporting remain incomplete.

### Coordinated local releases

`resolveReleaseSet(rootIds, manifests, hostVersion, backendVersion, pins, preferred)` resolves every active consumer together, returning dependencies first. Preferences retain compatible existing versions; explicit pins cannot move. `planLocalInstallation(data, rootDefinition, availableDefinitions)` returns only changed releases plus the explicitly selected root. A provider update can include consumer updates when needed; no unrelated compatible release changes simply because a newer one exists.

```ts
await session.installSet(
  rootModuleId,
  [
    {
      package: rootPackage,
      publicKey: trustedRegistryKey,
      configuration: rootConfig,
    },
    {
      package: dependencyPackage,
      publicKey: trustedRegistryKey,
      configuration: dependencyConfig,
    },
  ],
  { signal },
);
```

Supply one exact signed package per changed module. The installer checks the whole active set and signs nothing on the client's behalf. Every selected migration must succeed before code, data and the acceptance receipt commit together. `retryInstallation` recovers the entire staged set; `dismissInstallation` preserves previously installed code and records. Existing single-package calls and pending attempts remain supported.

The personal module interface downloads the required authorized candidates, displays separate configurations and preserves existing values. **Restore locally** resolves retained dependencies without a network connection. A changed server-selected release during download fails the review instead of silently substituting another version. See [coordinated local dependency acceptance](verification/local-dependencies/README.md).

## Governance and commerce

Organization policy is a DAG over roles with a protected `Administrador` root, multiple parents, opt-in inheritance, group grants and explicit denials. Validation rejects cycles, orphans and root denials. The editor supports dragging, zoom, a minimap and layered layout. The central permission matrix and module-filtered inspector use the same policy calculation and show permission sources. Group tags are stored; independent tag-targeted bulk policy editing remains open.

The corporate store supports free access, required approval and blocked access. Per-module policy can impose stricter restrictions. Existing invitations, assignments, approval requests, seat checks, persistent notifications and audit history remain integrated.

Configure Stripe with server-only `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_MODULE_PRICES` (a JSON map from module ID to Stripe price ID). The authenticated billing screen supports subscription checkout, portal and reconciliation. Subscribe Stripe to the endpoint `/api/v1/billing/webhook`. Use the public HTTPS API origin for webhook delivery. Checkout return URLs never grant access.

Signed raw webhook bodies are verified. Event IDs are deduplicated transactionally. Handlers retrieve current subscription state, reject customer mismatches and prevent an older subscription event replacing a newer active subscription. Only active/trialing subscriptions grant mapped entitlements. Module seat quantities are enforced on assignment; shrinking seat quantities retains oldest active assignments and removes excess assignments without deleting business records. Real provider delivery, delayed/duplicate webhook integration, taxes/invoicing and billing recovery journeys still require broader acceptance work.

## Desktop LAN transport

Independently published custom views request privileged effects through [typed host capabilities](module-host-capabilities.md). Signed declarations and current module permissions gate exports, notifications and access to an already enabled desktop LAN transport. LAN capability calls default to live authority. Signed `offline: "lease"` declarations support peer status and provisional relay over an already enabled, unexpired transport; [scoped acceptance](verification/lan-leases/README.md) verifies real TLS effects with the main-process API transport unavailable. New client packages require `client.host` revision 2. [Selected module authority](lan-authority.md) supports employee startup and protected offline restart. Read-only status cannot enable transport. Receipt recovery and wider acceptance remain in [SDK-05](sdk-05-acceptance.md).

LAN is optional. Members can enable a module-scoped session using its current relay grant; disconnected startup requires a signed offline grant acquired earlier. Administrators also retain the connected workspace-wide option. Bind provisioning to one company with `SUITE_LAN_WORKSPACE` (workspace UUID). Configure `SUITE_LAN_CERT`, `SUITE_LAN_KEY`, `SUITE_LAN_CA`, `SUITE_LAN_PEERS` (comma-separated certificate fingerprints), and `SUITE_LAN_ADDRESSES` (bounded private IPv4 addresses). Certificates need matching IP subject alternative names.

The transport uses TLS 1.3 mutual authentication, SHA-256 envelope checks, bounded message sizes and workspace-bound artifact/pending-envelope types. It tries ports 49180, 49181 and 49182, sends heartbeats every minute and rescans every ten minutes. Discovery limits concurrent probes locally. [Peer exchange and shared scan reservations](lan-discovery.md) provide bounded coordination; no global coordination guarantee is made during partitions. Pending envelopes are stored in main-owned encrypted quarantine with serialized, duplicate-safe writes and a ten-envelope limit. [Received packages](lan-package-relay.md) use a separate bounded, resumable chunk cache and can supply verified bytes to the ordinary server-accepted installer. The generic renderer relay/cache route is unavailable. Authorized same-account employees and connected administrators can review received drafts in Settings and explicitly submit declared queued changes through current server authority. Durable receipt outcomes preserve idempotency through a lost response and process restart/reauthentication; dependencies require protected local or current authoritative server acknowledgements, and conflicts/rejections remain visible. Accepted receipts can be dismissed; unconfirmed or invalid receipts can be archived, restored or explicitly deleted after review. [Draft recovery](lan-draft-recovery.md) includes bounded encrypted archive capacity and account-scoped file export/import without trusting claims of server acceptance. Recovery verifies the exact signed authoring release; new effects require an administrator-permitted compatible version, while already-committed exact requests can recover their result after a mandatory update. Broader profile/sign-out recovery and deployment acceptance remain unfinished. Receipt itself does not apply business state. Startup/discovery cancel on disable, lease expiry or logout, and newer authenticated revocations cannot be undone by stale policy responses.

## Verification

Run `pnpm db:migrate`, `pnpm db:seed`, `pnpm check`, `pnpm test:e2e`, `pnpm test:desktop`, and `pnpm test:restore`. `playwright.platform.config.ts` runs platform journeys against separate local ports 4301/4311. Standard browser tests reuse servers on 4300/4310, so rebuild web assets and restart the API after changing source when those servers are already running.

Tests cover a fifth signed declarative module without host edits, type rejection, schema validation, tenant isolation, journal conflicts, atomic stock reservation and SDK fulfillment retries, signature corruption, local TLS relay boundaries, generated UI, installation, encrypted standalone profiles and offline reload/reconnect. See the current verification record for actual executed results. These checks do not establish full release acceptance.

## Application and governance additions, 16 September 2026

- Contacts 1.1 adds a structured, archivable address resource with billing/shipping/office roles, contact links, street, city, region, postal code and country. The original free-text address remains compatible with existing records.
- Projects 1.1 adds `field.member()` assignment. The member directory only exposes active workspace member IDs and display names through a declared member field and current resource read permission. Server writes reject foreign/inactive members. Existing free-text assignments remain as assignment notes. Reference labels and options are cached with the authorized workspace working set and cleared on revocation.
- Inventory 1.2 adds an online physical-count operation. The dialog shows observed units and variance. The server locks the stock row, checks its separate stock version, refuses counts below reservations, appends count evidence (including zero variance), and commits stock, audit, outbox and idempotency together. This is a single-product count flow; multi-product counting sessions are not implemented.
- Notifications include inline approval/denial cards with current server request state. Delivery recipients use the same inheritance and explicit-denial evaluator as interactive authorization. Background web push remains open work.

Migration 012 is additive and preserves existing stock data. Release pins do not make arbitrary resource-schema downgrades safe: the migration manager enforces declared stored-schema compatibility. Full client update and rollback acceptance remains a release gate.

### Durable custom-command SDK contract

The SDK/storage foundation provides `client.queue(name, input, { key, dependencies })` and `client.queued(name, key)` for commands declaring `policy: "queued"`. The client needs a host-provided `ModuleQueue` as the third argument to `createModuleClient`. The corporate custom-view shell supplies this adapter with current view/command permissions, device-storage consent and lease checks. Its Saved commands dialog supports inspection, exact-key retry, explicit outcome resolution and saved command correction. Broader recovery remains under OFF-01 acceptance. Newly built views exposing queued commands require `client.queue` revision 1. The development preview supplies the same API through its in-memory simulator.

The return value is a state union: `pending` has delivery metadata, `accepted` alone has typed `value`, and `rejected`/`conflict` carry error details (including typed `businessError` when declared). `call` and `attempt` continue to return authoritative output rather than a provisional value. A stable caller-saved key supports later lookup. Use `isQueueCaptureError(error)` across independently bundled views. If capture throws this error, its `identity.key` must be retained because the durable write may have completed. Inspect or retry that key with identical input before considering a new command. A later module release must not reinterpret a saved result without its original contract.

See [host acceptance and remaining recovery work](verification/queued-commands/README.md). Server validation, current permission checks and offline leases remain mandatory; supplying a queue adapter does not grant authority.

### Durable custom-resource SDK contract

A resource declared with `policy: "queued"` exposes `client.resource(name).queue`. Known `online` and `local` policies do not expose queued authoring in the inferred type. Runtime checks also enforce the declared policy and append-only restrictions. Existing `create`, `update` and `archive` methods continue to return confirmed server results.

```ts
const prerequisite = await client.queue("capture", { name: "Prepare contact" });
const notes = client.resource("notes");
const captured = await notes.queue.create(
  { name: "Follow-up" },
  { dependencies: [prerequisite.key] },
);
const receipt = await notes.queue.get("create", captured.key);
if (receipt?.state === "accepted") {
  // The original request's result, not a promise that the record has not changed since.
  const base = await notes.get(receipt.value.id);
  await notes.queue.update(base.id, { name: "Reviewed" }, base);
  // To archive instead: notes.queue.archive(base.id, base.version).
}
```

The update and archive examples are alternatives using a known server base; do not invent a later version from pending work. Re-read the accepted record before a subsequent versioned action. Receipts distinguish pending, accepted, rejected and conflicting work and narrow their original input by action. Only accepted receipts contain a confirmed `value`. Capture errors retain the resource/action/key through `isQueueCaptureError`; inspect that identity before considering a new request.

Creation assigns a UUID record target before capture. A supplied retry key reuses the existing target; callers may also supply `id`. Retrying a key with different input or originally requested prerequisites fails. The durable journal preserves explicit command dependencies plus inferred reference and same-record ordering. A separately approved continuation may remap active prerequisites; receipts report that current scheduling graph without changing the saved request. The journal retains immutable capture prerequisites separately. Repeat capture with the original arguments, even after continuation; use receipt lookup when those arguments are unavailable. Older journals retain only the metadata they actually recorded, so already-lost original prerequisites cannot be reconstructed. Current view/resource permissions, storage consent and corporate leases apply to capture and lookup, and authoritative server validation still governs submission.

`ModuleQueue.resources` is the optional host adapter for these methods. Corporate views and the development simulator provide it; a host without it reports an actionable unsupported-host error. This API does not grant corporate authority to a standalone workspace. Newly built custom views require `client.resources` revision 4; the current host also retains revisions 1–3 for existing signed releases. Revision compatibility does not confer permissions or enable offline storage.

### Saved archive correction

The generated resource view reviews a rejected/conflicting archive separately from create/update forms. It loads the current server record under current read/write authority and displays its version beside the original target/base. `@suite/client/archive-recovery` fences the exact original before durably enqueuing a reviewed archive; accepted originals recover their validated receipt without replacement. The client holds the workspace synchronization lock across settlement and enqueue, rejects submitted dependents, and rechecks current authority and the exact installed release within storage transactions. Cancellation survives an interrupted local replacement.

Already-archived records offer explicit original-outcome resolution without another archive effect. Offline/access loss clears the current snapshot and blocks confirmation. [Ordinary archive acceptance](verification/archive-review/README.md) is complemented by [collision-target acceptance](verification/collision-archives/README.md): never-submitted same-record archives require an explicit existing/separate target, remain inert until prerequisites are accepted, and then use this current-record review. Repeated parent collisions preserve existing-target update/archive reviews. Original request bodies remain unchanged. Already-submitted collision descendants and legacy/profile recovery remain required; never-submitted custom commands use the review path below.

### Custom commands after create collisions

Never-submitted command descendants retain their exact capture calls and identities when a failed create is replaced. Execution prerequisites reconnect atomically; immutable SDK capture prerequisites remain available for retries. Separate `createRecovery` metadata records original/replacement record IDs. The commands remain conflicts until individually reviewed, and accepting the replacement create does not execute them.

Command review preserves partial input across restart, displays the replacement context and requires accepted prerequisites before submission. Saving and replacing reject stale recovery context. The generated resource view exposes the same Saved commands inbox as custom views. Its collision recovery uses verified original/current command contracts and live installation/permission checks. [Scoped acceptance](verification/collision-commands/README.md) records the completed checks and remaining gates.

Accepted descendants now end a failed-create recovery branch: their exact requests, receipts and record effects stay unchanged. Unknown outcomes still block replacement. After server cancellation, an attempted custom command can enter the explicit review flow without reusing its cancelled request for execution. Cancelled command chains require individual reviews and selected prerequisite continuation. [Outcome recovery evidence](verification/collision-outcomes/README.md) records this scope. Server-cancelled resources now retain exact requests and enter explicit reviews with their own recovery-context snapshot. Saving/submitting a stale snapshot fails; resuming after a changed parent reloads the selected target and rebuilds the comparison without discarding saved input. Archive confirmation passes the exact displayed context to durable replacement. Cancelled-archive browser/native acceptance is recorded; cancelled create/update, repeated-collision saved/open resource reviews and broader mixed-resource acceptance remain required.

### Saved command correction

Rejected or conflicting commands can retain a separate review, including partial invalid input, without changing the original request or submitting work. Uncertain requests must resolve their original outcome first. Saving persists the input, current signed release, revision and explicitly selected never-submitted dependents. Stale reviews, changed dependent input and changed authority require another review.

When an installed schema removes fields from a saved review, the shared form displays their retained values with explicit per-field removal from the draft, including nested objects. It does not automatically strip old input. Closing without saving preserves the previous complete review; an explicit save associates the revised input with the current signed release. Required fields still need valid values. See [three-release review recovery](verification/command-schema-review/README.md).

Preparing a correction requires connectivity and a valid current command contract. The server settles the exact original identity before a new pending request is recorded. If the original was accepted, its verified result is recovered and the separate review remains unsubmitted. Otherwise, authoritative cancellation is persisted before an atomic local replacement. Lost replies and interrupted local commits retain the original identity and review for safe recovery.

Only selected eligible dependents continue after the replacement; their request bodies stay unchanged. Unselected work remains attached to the original. Explicit prerequisites persist and reference-derived prerequisites are recalculated from the corrected input. The host also presents eligible cross-module commands and saved resource writes, with the owning module and original signed input. The child’s verified installed dependency graph, original/current policies and current grants govern access. Continuation checks use current transaction storage; they do not widen the owning module’s normal capture interface. An unavailable saved selection is retained until access is restored or the user explicitly removes it. See [cross-module continuation and its acceptance limits](verification/command-continuation/README.md). [Public queued-resource authoring](verification/resource-continuation/README.md) now has command-to-create and create/update/archive lifecycle acceptance. [Reviewed update/archive descendants](verification/resource-descendants/README.md) now verify selected-only execution, original SDK recapture, restart and revoked child authority. [Submitted outcome recovery](verification/submitted-descendants/README.md) verifies original command/create/update/archive identities after approved parent continuation, lost replies and restart. Accepted effects are recovered once; authoritative cancellation fences the exact original. Legacy/source-contract and failed-create target-replacement transitions remain required work.


Recovery checks current access again after asynchronous reads/signature verification before settlement, and inside the final uncertain-outcome storage transaction. A held reply cannot authorize a new replacement after the view loses access. [Real-client expiry/revocation acceptance](verification/command-authority/README.md) preserves the saved review until fresh authorization and explicit continuation. The host now verifies retained original/review contracts and requires their operation permissions as well as the active installed permission. [Upgrade acceptance](verification/command-upgrade/README.md) covers a changed permission and new required input field; [retired command recovery](verification/command-retirement/README.md) now separates read-only historical access from execution. A removed/reclassified command retains original input and a separately saved review; both original/current grants apply where the current operation exists. Explicit server settlement recovers its original receipt or cancels its exact identity without invoking a handler. Generated resource screens use the shared workspace coordinator, which also checks both original/current command contracts and never dispatches retired commands. [Historical-grant administration](verification/historical-permissions/README.md) now uses a signed catalogue shared by People, the central matrix and server validation. Other-release declarations retain module/version provenance, and matrix filtering follows declared sources, including shared identifiers. These grants can authorize supported older clients as well as recovery; current module authority remains mandatory. Command export and host-owned resource/draft recovery now have scoped acceptance below; the workspace scheduler is documented below.


### Recovery after view removal or device uninstall

Settings > Offline work on this device includes [host-owned command recovery](verification/command-recovery-host/README.md). It uses the same original input/review contracts and settlement kernel without mounting module code. The current server-selected contract governs connected inspection; verified downloaded contracts and the existing lease govern offline inspection. Uninstall retains the last device contract independently of original input contracts, without retaining executable installation authority.

Recovery requires original/current operation grants and module availability, not the old view's permission. It never captures, dispatches or prepares corrected commands; only an explicit action settles the exact original request. Missing/corrupt contracts fail closed, and current suspension or revoked access still blocks recovery. Advanced host-owned reviews and independent exports have scoped acceptance below; broader scheduling/profile gates remain open.


### Record and draft recovery outside module views

The same Settings surface now includes [saved records and drafts](verification/resource-recovery-host/README.md). Journaled requests retain their original resource schema and base values; ordinary drafts and independently saved reviews remain separate. Explicit recovery reads an accepted receipt or cancels the original retry identity, with no handler execution, correction, resubmission or draft deletion. An optional journal `recoveredAt` marker retains the verified original contract for later accepted-receipt inspection.

The host requires the original resource read/write permissions and current module access; a removed navigation entry is not an authorization requirement. Corporate settlement rejects local-only resources. Draft-only uninstall retains the last signed device contract. Unknown legacy schema versions remain unavailable for interpretation. [Advanced review acceptance](verification/host-review-recovery/README.md) now covers queued/direct comparisons, original collision-source drafts and archived input through offline uninstall/reinstall. Archived reviews use retained request provenance for their original base, and explicitly report unavailable original values. Reinstallation preserves saved work and permits the original explicit correction workflow. Further source-schema/legacy transitions and profile/sign-out recovery retain their tracked gates.

### Independent saved-work exports

Settings can export individual saved requests and drafts independently of module views or installation. The public versioned format retains original request identity/input/state, separate reviews, comparisons, draft targets, versions and original collision/archive provenance. It is a copy of device observations, with no automatic import or execution authority. Export never changes saved work.

[Browser/native acceptance](verification/work-recovery-export/README.md) verifies original/current permissions, offline lease checks and revocation before delivery. Electron main observes authenticated catalog metadata under the current policy revision; Settings prepares exact retained source releases after reauthentication. Native save authorization runs again after the dialog. Unknown source contracts remain unavailable. Authentication failure locks corporate recovery without deleting pending work. Broader scheduling, dependent recovery and profile/sign-out journeys remain tracked separately.

### Workspace synchronization

The workspace owns automatic queued dispatch on reconnect/policy change and every 15 seconds while the app is open. Generated writes, custom-command capture and explicit retries share the same coordinator. No module view needs to be mounted. Current installation/dependency verification, compatible pins/storage, original/current queued policies and operation/resource grants govern dispatch; original request identities and journal ordering remain unchanged. Uninstall and retired operations pause their work, while a removed view alone does not pause an otherwise eligible command.

The coordinator uses the existing workspace lock and journal, checks installation again before transport and stops further dispatch after authority/scope loss. Settings itself still only inspects, exports or explicitly settles saved work. [Acceptance and limits](verification/workspace-synchronization/README.md) distinguish coordinator behavior from broader dependent recovery, profile transitions and execution while the app is closed.

## Sign-out and saved work

Corporate sign-out ends access and retains saved business data. Account revisions expire offline authority; remembered entry is removed. Browser session termination has a durable pending record and a hash of the old session’s random CSRF token, so reconnect can end an old cookie session while recognizing fresh authentication. Host sign-in/logout share a browser lock. Server authorization remains mandatory for resubmission; unsubmitted work whose permission was revoked remains held. Native credential deletion is separate from encrypted account data and serialized against refresh writes. Protected native/provider acceptance and explicit profile-removal recovery remain unfinished; see [scoped evidence](verification/signout-recovery/README.md).
