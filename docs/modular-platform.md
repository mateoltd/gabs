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

Declare a provider operation with `public: true`; use `serviceReference(provider, "operation")` in a consumer's `services` map and declare the provider dependency. An administrator separately grants each public service under module configuration. The host rechecks actor permissions, activation, assignment, grant and exact service contract on every call. Custom events use `module.<id>.event.<name>` to avoid collisions with host events. All records, audit entries, outgoing events and the outer idempotency receipt share one transaction. A caught failed capability call still aborts the transaction; detached capability calls are drained before commit. Service recursion is bounded and cyclic calls fail.

Orders and Inventory retain an explicit `defineTrustedModuleServer` migration bridge for their existing SQL-backed business services. They are reviewed host code; these two bridges still require migration to fully scoped repositories. Trusted code is not a hostile-code sandbox. Independently signed packages now carry reviewed client and scoped server JavaScript, as described in the release workflow.

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
