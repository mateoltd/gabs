# Common

A hosted modular business suite with a React web client and an Electron desktop client. Contacts, Projects, Orders and Inventory share an authoritative transactional backend. A typed module SDK, signed registry and hybrid operation journal extend the platform. Provisional local changes are separate from confirmed business state.

## Run locally

Requirements: Node **24.19.0**, Docker, and **pnpm 12.4.1**. The exact package manager and dependency versions are pinned. Run commands from the repository root.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
```

Start these in separate terminals:

```sh
pnpm dev:api
pnpm dev:web
pnpm dev:worker
```

Open **http://localhost:4300**. Choose Alex Morgan, the demonstration Owner, and Northline Supply. The other local accounts demonstrate Sales, Warehouse, and Viewer permissions. Development sign-in is restricted to loopback and development/test mode.

For the native client:

```sh
pnpm dev:desktop
```

With `AUTH_MODE=development` in `.env`, choose **Open local workspace** to sign in as the seeded Owner. No Auth0 tenant is needed for this local pilot. Development uses its own profile and is restricted to an unpackaged app talking to a loopback API. Start it with the root command above so `.env` is loaded.

Packaged applications require HTTPS and configured Auth0 native-client settings. `package` and `make` reject missing configuration; an installer made only for a packaging check cannot sign in. See [Auth0 setup](docs/operations.md#auth0-configuration) for hosted authentication.

For the web offline shell, use the production assets:

```sh
pnpm --filter @suite/web build
pnpm --filter @suite/web preview
```

Stop the Vite development server before starting preview because both use port 4300. In Settings, enable offline storage on the device, open Orders, and allow the service worker to prepare the shell. The default corporate lease is 24 hours; administrators may shorten or disable it.

## Modular platform implementation

See the [implementation guide](docs/modular-platform.md) for the SDK, registry, offline model, Stripe and optional LAN configuration. The [product vision](docs/product-vision.md) preserves the approved direction; the [parity tracker](docs/parity-tracker.md) records priorities, dependencies, acceptance gates and the current handoff. The [requirement ledger](docs/requirement-ledger.md) maps every original requirement and explicitly identifies unfinished work. The complete approved plan is **not yet release-complete**.

Development seeding creates local signing keys and signed releases of the four official modules. It never overwrites private keys. Production uses a separately managed trust root and reviewed release workflow.

## Implemented foundation

- Workspace discovery and creation; company invitations, seat checks, protected ownership, custom business roles, module activation, assignments, and access approvals.
- Products, reasoned receipts and adjustments, an immutable stock ledger, order drafts, atomic reservation, fulfillment, and cancellation.
- PostgreSQL tenant isolation, composite tenant references, conditional writes, transactional idempotency, audit history, outbox processing, notifications, and authorized CSV exports.
- Shared web/desktop shell, accessible components, system/light/dark appearance, user/workspace scoped storage, local drafts, expiry, reconnect, conflict handling, and logout cleanup.
- Auth0 web sessions and native PKCE implementation; constrained Electron bridge, OS-backed encrypted storage, packaged assets, navigation restrictions, signing configuration, and update hooks.
- Generated OpenAPI and portable client types, dependency-boundary checks, container builds, CI and desktop release workflows, load testing, and a local restore drill.

## Verify

```sh
pnpm check
pnpm format:check
pnpm build
pnpm generate:api
pnpm test:e2e
pnpm test:desktop
pnpm test:load
pnpm test:restore
```

PostgreSQL must be running and migrated before integration tests. Browser tests need seeded demonstration data and Chromium (`pnpm exec playwright install chromium`). Native tests build the desktop application automatically. Tests create isolated fixture workspaces; they do not erase existing data. Load and restore tools deliberately reject production mode.

See [UI conventions](docs/ui.md), [verification results](docs/verification/README.md), [architecture and behavior](docs/architecture.md), and [deployment and operations](docs/operations.md).

## Release status

This is a working local pilot, not a deployed production service. Auth0 tenant configuration and live MFA/refresh flows, private cloud storage, managed backups and alert routing, signing credentials, hosted updates, and Windows/Ubuntu runtime acceptance require deployment environments. CI includes those platforms' packaging jobs, but those remote jobs have not run here.

External invitation email delivery and screen-reader testing with assistive technology are not completed pilot features. Invitations are visible to the intended verified account after sign-in. Mobile, accounting, tax invoicing, returns, partial fulfillment, unreviewed executable plugins and autonomous offline stock commitments are outside the implemented scope. Stripe integration exists but has not been accepted against a live payment-provider environment.
