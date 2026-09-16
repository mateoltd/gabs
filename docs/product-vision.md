# Product vision and parity contract

Approved direction: **Modular ERP platform with a typed SDK and hybrid offline support**. This document preserves the decisions from the user's approved plan; the [execution tracker](parity-tracker.md) records unfinished work, and the [requirement ledger](requirement-ledger.md) preserves all 29 original specification IDs.

## Outcome

Deliver a complete modular business suite for primarily office workflows. Module development, distribution, installation, administration, permissions and commerce are first-class product capabilities. Contacts, Projects, Orders and Inventory prove the platform through public contracts. A fifth module must be authored, built, published and installed without editing host source, central module unions, navigation registries or routing.

Workspaces isolate data, configuration, branding and permissions. Personal work opens by default. Company modules remain hidden until an administrator has configured, reviewed and published them. Purchasing, entitlement, organization activation, user assignment, device installation and runtime availability remain separate concepts.

## Architectural decisions

- React and TypeScript for web, desktop UI, SDK and business services; Electron for desktop; PostgreSQL and the server authorize shared corporate state.
- A small typed SDK exposes schemas, resources, operations, configuration, permissions, events, services and views. Schemas derive runtime validation, clients, generated UI, documentation and manifests. TypeBox stays behind the public API.
- Each operation declares `local`, `queued` or `online`. Offline corporate edits remain provisional until current server authorization and business validation accept them. Stock, spending, approvals, licenses and corporate publication require server acceptance.
- Corporate caches and journals are account/workspace scoped. Durable operation identities, dependencies and base versions support safe retries and visible conflicts. The default corporate offline lease is 24 hours and may be shortened or disabled. Expiry locks access without silently discarding pending work.
- Standalone personal modules may remain local indefinitely. Moving their data into a company is an explicit validated import.
- Public services with explicit grants carry actor, workspace and transaction context. Business writes, audit, idempotency and outgoing events commit atomically. Clients cannot supply trusted totals, roles or approval status.
- Web persistence uses IndexedDB. Desktop persistence uses encrypted SQLite in a utility process, protected credentials and narrow typed IPC. Workers serve substantial local computation and standalone execution where needed.
- Official reviewed modules ship first. Signed, independently versioned packages declare dependencies, compatibility, permissions and configuration. Reviewed code is trusted application code; workers and Shadow DOM are not hostile-code security sandboxes.
- Stripe webhooks, verified and idempotently processed, govern entitlements. Checkout redirects do not grant access. Uninstall preserves business data; destructive deletion is a separate administrator action.
- Organization policy uses the protected Administrador root, multiple-parent DAG, opt-in inheritance, combined grants and explicit denial precedence. The central matrix and module inspector share the same evaluator.
- Web and desktop must deliver usable profiles, notifications, all four applications, a semantic accessible UI kit, ten substantive archetypes and light/dark/system/high-contrast modes. Applicable AAA contrast evidence does not imply whole-product AAA compliance.
- Optional permission-gated LAN transport retains three-port fallback, one-minute heartbeat and ten-minute rescans. Relays never finalize corporate business changes.

## Intentional replacements and explicit deferrals

Electron replaces the original Rust/Tauri baseline. Hybrid server authority replaces unrestricted corporate offline commitments. Signed packages and scoped entitlement leases replace per-user executable DRM. Standard authenticated TLS replaces mandatory custom traffic padding. Universal spyware detection, unextractable executable code, guaranteed JavaScript memory erasure and protection against a compromised OS are not promised.

Mobile, branch servers and preallocated offline stock/spending rights are deferred. Purchasing, expenses and other later applications are extension targets, not part of the initial four-module completion claim. Other unfinished approved requirements remain open; they are not silently deferred.

## Definition of parity

All eight gates in the [tracker](parity-tracker.md#release-acceptance-gates) must have current, linked evidence. That includes real web and packaged desktop journeys, adversarial business/authorization tests, failure and recovery exercises, provider-backed commerce/identity acceptance and operational recovery. No required implementation or external acceptance item may remain open when parity is claimed.

Changes to this contract require an explicit user decision. Preserve the decision and its effect on requirements in the tracker rather than rewriting history.
