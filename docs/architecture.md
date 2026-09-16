# Architecture and behavior

The [modular platform implementation](modular-platform.md) and [requirement ledger](requirement-ledger.md) describe the new SDK, registry, governance, commerce and hybrid execution extensions. Remaining limitations there are release gates.

## Boundaries

The API and worker are separate processes from one modular monolith. PostgreSQL is the source of shared business state. Orders uses Inventory's public reservation/release/fulfillment service in the same database transaction. Notifications and exports use the committed outbox.

```text
apps/web          Browser entry point and asset-only service worker
apps/desktop      Electron main, preload and renderer
apps/api          HTTP composition, authentication, runtime route schemas
apps/worker       Claimed job execution and notification delivery
modules/orders    domain, contracts, server, web
modules/inventory domain, contracts, server, web
packages/app-web   Shared application shell
packages/contracts Platform schemas and operation registry
packages/api-client Generated OpenAPI types and portable transport
packages/platform Narrow storage/file/notification interfaces and adapters
packages/server-core Authorization, transactions, governance, migrations
packages/ui-web    Accessible React components
packages/design-tokens Platform-neutral visual tokens
```

`pnpm lint` rejects server/native imports from browser views, platform dependencies in pure domains, private cross-module imports, and dependency cycles. API composition can read module tables; business writes remain in the owning module's public service. A future mobile client can reuse contracts, client types, domain rules and tokens, with its own UI and platform adapter.

Reviewed server and custom React code are staged in the host build. Declarative module definitions can be signed, published and installed independently through the registry. Activation, entitlement and installation are separate. Error boundaries recover from rendering failures; the module system is not a hostile-code sandbox.

## Business invariants

One workspace currency, one stock location, whole units. Monetary amounts are integer minor units; the pilot defaults to EUR. Each SKU is unique within its workspace. Available stock is on-hand minus reserved stock. Every balance change has an append-only movement. Adjustments cannot reduce on-hand below reserved stock.

A saved order draft does not reserve stock. Confirmation locks the order and stock rows, validates every line and reserves all quantities. Fulfillment consumes the reservation once. Cancelling a confirmed order releases it once; cancelling a fulfilled order is rejected. Confirmed prices and lines are immutable. Changing them requires cancellation and a new draft. Products and customers are snapshotted in orders; a customer's name belongs to that order's minimal customer record.

All mutations of a stock workflow, audit records, successful idempotency result and event records commit together. Product locks use sorted product IDs. Deadlocks and serialization failures retry at most twice after the first attempt. No notification consumer owns stock consistency.

## Identity, authorization and tenancy

An application user is keyed by OIDC issuer and subject. Membership, role assignment, entitlement, module activation and module assignment are separate records. Every tenant operation validates current membership, resource workspace, module dependencies and action permissions. Orders permissions authorize their own inventory integration; Sales cannot perform unrestricted adjustments.

Owner and Administrator are protected roles. Only owners can manage ownership and the last owner cannot be removed. Company owners and administrators must have an MFA-verified session. Custom roles can include only registered business permissions. Invitations expire after seven days and require the intended verified email. Pending invitations consume no seats; acceptance and seat checks share a workspace lock.

All tenant tables use FORCE RLS and tenant composite foreign keys. A transaction sets `app.workspace_id` locally. The runtime roles do not own tables or bypass RLS. A non-login `suite_control` role owns four narrow discovery/dispatch functions and one aggregate health function. It has explicit cross-workspace policies on only the relevant tables; ordinary runtime roles cannot assume it.

New production workspaces start with inactive entitlements and Draft modules. An operator grants the pilot allowance using the administration CLI; an owner then enables Inventory before Orders. Local development workspaces receive demonstration entitlements automatically.

## API

`/api/v1` uses runtime TypeBox request/response schemas. `pnpm generate:api` emits `docs/openapi.json` and `packages/api-client/src/schema.d.ts`. The portable client supports named operations and response types; runtime validation remains authoritative for input. Lists use opaque UUID cursors, bounded page sizes and optional search. Lists represent the current page, not global totals.

POST commands require an idempotency key. Replaying the same operation and payload returns its stored result after rechecking current authorization. A different payload with that key returns 409. Editable records require an `If-Match` version; stale versions return 412, missing versions 428. Draft uploads also use idempotency keys for PUT retries. Uncertain client commands retain their original key and input.

Errors contain a stable code, readable message and request ID. API responses are not cached by the service worker. Authentication cookies are Secure in production, HttpOnly and SameSite=Lax; mutations require the configured Origin and session CSRF token. Request logs omit URL query strings, cookies and tokens.

## Offline and native behavior

Only a device opt-in and an active workspace offline policy permit company snapshots. The snapshot contains a bounded first page of permitted products and orders and a server-derived expiry. It is a working subset, not a replica of the entire company. Search can find additional catalog products while online. Unsent drafts remain stored after expiry but are hidden until online revalidation succeeds.

Queries and persistence are scoped by both user and workspace. Switching workspace cancels obsolete browser reads, remounts module state and prevents late responses from filling the new workspace. Reconnection refreshes identity and authorization before enabling uploads. Upload never confirms an order. A stale server version keeps local input and presents explicit conflict resolution.

Web storage uses IndexedDB and can be evicted. Storage failure does not claim success. Logout clears local state; offline web logout retains a marker so the next connection invalidates the still-HttpOnly server session before allowing sign-in. Revoked membership clears that workspace's local data when the client learns of it. Cache expiry is application behavior, not remote erasure.

Electron loads packaged assets with Node integration disabled, context isolation and sandboxing enabled. A named operation allowlist replaces arbitrary authenticated HTTP or filesystem access. Login, tokens, PKCE and refresh live in main. Tokens and caches use OS-backed safeStorage encryption, with session-only credential fallback if unavailable. No native credentials are exposed through preload. Local pending operations may remain volatile in that fallback.

The updater installs a downloaded full release on explicit application quit. Linux uses a signed release distribution process and manual package updates; Electron's built-in autoUpdater is not used there. Unsupported versions receive 426 and retain their local files for recovery after update.

## Deliberate limits

A working pilot is not a full ERP. Mobile, unreviewed third-party executable plugins and authoritative offline corporate commitments remain excluded. Groups, an organization DAG, Stripe integration and optional LAN relay are now implemented to the extent recorded in the requirement ledger. Independent executable bundles remain unfinished. Workspace branding supports a PNG logo, accent palettes and initial variants of the ten design archetypes. Outbound invitation email is follow-up product work. Operational and platform acceptance gates are tracked separately from locally verified behavior.
