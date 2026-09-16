# Modular platform implementation

This document describes implemented behavior, not a production-release claim. The [requirement ledger](requirement-ledger.md) identifies the remaining work against the complete approved plan and all 29 original specification IDs.

## Runtime

React and TypeScript run in the web client and Electron renderer. Corporate writes execute in the Fastify/PostgreSQL host. The PostgreSQL transaction includes authorization, business changes, history, audit, idempotency results and outbox events. No desktop peer can finalize a corporate write.

- `packages/module-sdk`: authoring, runtime schema validation, inferred clients, typed server handlers, dependency resolution, policy calculation and journal protocol.
- `packages/module-catalog`: generated discovery of module definitions and reviewed server entry points. Browser imports do not include server code.
- `apps/api/src/platform.ts`: generic resources, typed business operation dispatch, organization policy, installation and artifact delivery.
- `packages/server-core/src/module-runtime.ts`: workspace-scoped resources, revisions, conflict merging and reference grants.
- `packages/app-web/src/module-view.tsx`: generated resource screens with forms, search, pagination, archive and provisional changes.
- `modules/contacts`, `modules/projects`: declarative applications with generated screens. Orders and Inventory use SDK operation handlers around their transactional business services and retain their richer existing screens.

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

Default Orders and Inventory releases retain their `defineTrustedModuleServer` SQL bridges. Independently signed [Inventory](verification/inventory-sdk/README.md) and [Orders](verification/orders-sdk/README.md) 2.0 candidates now use scoped SDK capabilities. Read models, client adapters and authoritative relational-data conversion still precede their coordinated rollout. Trusted official code is not a hostile-code sandbox.

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

Scaffolding creates the manifest, example fixture and package. `check` validates fixture schemas with resource/index diagnostics. `dev` starts a loopback-only developer workspace at http://127.0.0.1:4321 (override `MODULE_DEV_PORT`). It generates input forms, previews accepted records, simulates connectivity and permissions, and displays provisional/accepted/rejected journal entries and emitted events. Source changes restart and reload the isolated simulation; fixtures and simulated changes reset. The `@suite/module-sdk/simulator` adapter supports typed fixtures and direct tests. It does not use corporate data. Cross-module provider integration, historical merge behavior and real persistence require the PostgreSQL/browser tests; the simulator is not evidence of server correctness. Newly published releases load without an API restart. Neither a central module union nor a host route edit is needed. Modules with operations or storage migrations require an independently signed, reviewed server package staged through the registry before publication.

`pnpm db:seed` creates development-only signing keys and signs the four official definitions. For a separate trusted publisher environment, `pnpm module keygen` creates a new key pair once. Existing private keys are never overwritten. Private keys and built artifacts live under ignored `.local/`. Production requires operator-managed trust keys and signing/release procedures.

### Trust and installation

Packages contain canonical JSON metadata, SHA-256 digest, Ed25519 signature and signing-key fingerprint. The resolver honors exact workspace pins and host/backend/dependency ranges. Publication is immutable for a module/version; changed content requires a new version.

Entitlement, organization activation, membership assignment, device installation and runtime availability are separate. The Modules screen verifies signatures, downloads dependencies, configures and publishes modules, manages grants and pins, repairs installations, and uninstalls without deleting business records. Verified package downloads and exact install/removal attempts survive interruption. The previous local installation remains until every replacement verifies and the server acknowledges that exact selection. A durable request ID and server receipt recover lost replies and failed local commits without duplicate effects. [Device lifecycle recovery](module-lifecycle-recovery.md) documents the protocol and browser/native evidence.

Assigned, entitled, published modules install in the background on the next authorization/catalog refresh, without first opening their screen. Approval propagation is currently polled, not pushed. Cancelling the active workspace prevents remaining background installation steps. Explicitly uninstalled modules require manual reinstall. Web/desktop module entry checks verified installation state. Configuration and suspension remain authoritative server checks on every operation. A disconnected client cannot discover a new suspension before its lease expires.

The registry distributes signed contracts, custom React bundles and scoped server artifacts. The [protected operator workflow](module-server-releases.md) submits, reviews, stages and publishes official releases. Exact reviewed backend versions coexist and dispatch against the workspace's selected signed contract. [Per-module storage migrations](module-storage-migrations.md) preserve data on failure and restrict executable rollback to compatible schemas. Interrupted update/repair and schema-safe rollback have local acceptance. Mandatory rollout and hosted trust-rotation acceptance remain open. The fifth-module proof covers independent reviewed executable loading; it is not a hostile-code sandbox. External publisher onboarding remains future scope.

## Offline and local work

Corporate offline access defaults to a maximum 24-hour authorization lease. Administrators can shorten it or disable it. Devices opt in before persisting corporate records. The web uses IndexedDB; Electron stores AES-256-GCM encrypted record payloads in SQLite in a utility process, with the master key wrapped by OS credential storage. SQLite record keys and database metadata are not encrypted; this is not SQLCipher or a claim of full-file encryption.

The journal stores stable operation IDs, inputs, base versions, dependencies and pending/accepted/rejected/conflict states. The server reloads the historical base to merge disjoint edits. It never trusts a client-supplied base image. Conflicts retain provisional contents for review; dependency failures do not block unrelated entries. A revoked membership clears cached readable pages and locks access while preserving the journal for authorized recovery. Lease expiry does not delete pending work. Explicit sign-out currently removes local corporate data and is identified in Settings; a richer recovery/export flow remains necessary.

Standalone profiles use a separate encrypted IndexedDB vault with AES-GCM and a PBKDF2-derived key. They can create/edit supported local resources, lock, unlock, export and remove a profile. Backgrounding locks the local profile. Local authority is indefinite and separate from company records. Native biometric unlock, saved online-profile management and validated company import remain unfinished.

## Governance and commerce

Organization policy is a DAG over roles with a protected `Administrador` root, multiple parents, opt-in inheritance, group grants and explicit denials. Validation rejects cycles, orphans and root denials. The editor supports dragging, zoom, a minimap and layered layout. The central permission matrix and module-filtered inspector use the same policy calculation and show permission sources. Group tags are stored; independent tag-targeted bulk policy editing remains open.

The corporate store supports free access, required approval and blocked access. Per-module policy can impose stricter restrictions. Existing invitations, assignments, approval requests, seat checks, persistent notifications and audit history remain integrated.

Configure Stripe with server-only `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_MODULE_PRICES` (a JSON map from module ID to Stripe price ID). The authenticated billing screen supports subscription checkout, portal and reconciliation. Subscribe Stripe to the endpoint `/api/v1/billing/webhook`. Use the public HTTPS API origin for webhook delivery. Checkout return URLs never grant access.

Signed raw webhook bodies are verified. Event IDs are deduplicated transactionally. Handlers retrieve current subscription state, reject customer mismatches and prevent an older subscription event replacing a newer active subscription. Only active/trialing subscriptions grant mapped entitlements. Module seat quantities are enforced on assignment; shrinking seat quantities retains oldest active assignments and removes excess assignments without deleting business records. Real provider delivery, delayed/duplicate webhook integration, taxes/invoicing and billing recovery journeys still require broader acceptance work.

## Desktop LAN transport

LAN is optional, administrator enabled, and requires a corporate offline lease. Configure `SUITE_LAN_CERT`, `SUITE_LAN_KEY`, `SUITE_LAN_CA`, `SUITE_LAN_PEERS` (comma-separated certificate fingerprints), and `SUITE_LAN_ADDRESSES` (bounded private IPv4 addresses). Certificates need matching IP subject alternative names.

The transport uses TLS 1.3 mutual authentication, SHA-256 envelope checks, bounded message sizes and workspace-bound artifact/pending-envelope types. It tries ports 49180, 49181 and 49182, sends heartbeats every minute and rescans every ten minutes. Discovery limits concurrent probes locally. It does not yet implement peer-list gossip or distributed scan budgets; no global coordination guarantee is made during partitions. Relayed envelopes are stored in an encrypted inbox; they are not silently applied to authoritative business state.

## Verification

Run `pnpm db:migrate`, `pnpm db:seed`, `pnpm check`, `pnpm test:e2e`, `pnpm test:desktop`, and `pnpm test:restore`. `playwright.platform.config.ts` runs platform journeys against separate local ports 4301/4311. Standard browser tests reuse servers on 4300/4310, so rebuild web assets and restart the API after changing source when those servers are already running.

Tests cover a fifth signed declarative module without host edits, type rejection, schema validation, tenant isolation, journal conflicts, atomic stock reservation and SDK fulfillment retries, signature corruption, local TLS relay boundaries, generated UI, installation, encrypted standalone profiles and offline reload/reconnect. See the current verification record for actual executed results. These checks do not establish full release acceptance.

## Application and governance additions, 16 September 2026

- Contacts 1.1 adds a structured, archivable address resource with billing/shipping/office roles, contact links, street, city, region, postal code and country. The original free-text address remains compatible with existing records.
- Projects 1.1 adds `field.member()` assignment. The member directory only exposes active workspace member IDs and display names through a declared member field and current resource read permission. Server writes reject foreign/inactive members. Existing free-text assignments remain as assignment notes. Reference labels and options are cached with the authorized workspace working set and cleared on revocation.
- Inventory 1.2 adds an online physical-count operation. The dialog shows observed units and variance. The server locks the stock row, checks its separate stock version, refuses counts below reservations, appends count evidence (including zero variance), and commits stock, audit, outbox and idempotency together. This is a single-product count flow; multi-product counting sessions are not implemented.
- Notifications include inline approval/denial cards with current server request state. Delivery recipients use the same inheritance and explicit-denial evaluator as interactive authorization. Background web push remains open work.

Migration 012 is additive and preserves existing stock data. Release pins do not make arbitrary resource-schema downgrades safe: the migration manager enforces declared stored-schema compatibility. Full client update and rollback acceptance remains a release gate.
