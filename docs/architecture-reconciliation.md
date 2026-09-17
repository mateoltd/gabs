# Architecture reconciliation

Status: proposed target, 17 September 2026. This precedes further feature-parity expansion following the user's architecture feedback. No source migration has started. Product scope and the later UI-refinement goal remain unchanged.

## Diagnosis

The directory structure reflects incremental implementation more than stable ownership:

- `packages/app-web/src` contains all 33 source files directly, including shell, administration, installation, profiles and module rendering. `index.tsx` is 1,482 lines; `admin.tsx` is 1,505 lines.
- `packages/platform/src` combines browser persistence, native contracts, local profiles, worker execution and business-specific cache types. `local-profiles.ts` is 1,651 lines in the current working tree.
- `packages/server-core/src` has all 26 source files directly, spanning identity, authorization, governance, storage, release administration and module execution.
- `packages/contracts/src/index.ts` imports Orders and the bundled catalog. Generic platform types include order-specific drafts and pending commands. The reusable foundation therefore knows about concrete applications.
- The generated catalog imports module implementations and server internals. Its role is application assembly, not a foundational contract dependency.
- `tooling/check-boundaries.mjs` partially checks cross-module imports against a fixed Orders/Inventory list. This does not enforce the intended extensible architecture.
- A root TypeScript configuration includes both DOM and Node environments throughout the repository. Package exports and some boundary checks exist, but environment separation needs stronger enforcement.

These are verified source observations, not evidence that every large file needs its own package. Generated API declarations are excluded from the large-file diagnosis.

## Proposed organization

Directories express ownership. A directory becomes a workspace package only when it needs an independent dependency, execution, build or public API boundary. Grouping folders are not packages. Keep small cohesive files together; introduce deeper folders when they clarify a real subsystem.

```text
apps/
  web/                       Browser entry and app composition
  desktop/
    src/main/                Electron lifecycle and privileged adapters
    src/preload/             Narrow typed IPC bridge
    src/renderer/            Shared-shell entry
    src/utility/             Persistence and isolated computation
  api/                       HTTP composition and transport
  worker/                    Background-job composition

packages/
  sdk/
    src/authoring/           Definitions, fields, operations, services
    src/contracts/          Module protocols and validation
    src/client/             Typed module clients and query helpers
    src/testing/            Scenarios and simulation
    src/documentation/      Schema-derived references
    node/                    Build and signing entry points
  contracts/
    src/identity/
    src/workspaces/
    src/commerce/            Platform wire contracts, no bundled modules
  client/
    src/api/                 Platform transport and generated API types
    src/identity/            Profiles, unlock and lease access
    src/offline/             Cache, journal, retry and conflicts
    src/modules/             Installation and module lifecycle
    src/local/               Standalone runtime and worker coordination
    src/adapters/            Browser persistence and capability adapters
  server/
    src/identity/
    src/governance/
    src/commerce/
    src/registry/
    src/runtime/             Scoped module execution and service calls
    src/persistence/         Database, transactions and repositories
    migrations/
  shell/
    src/app/                 Providers, routes and shell composition
    src/navigation/
    src/features/
      identity/
      workspaces/
      administration/
      modules/
      notifications/
    src/styles/              Shared shell foundations
  ui/
    tokens/                  Design tokens
    web/
      src/controls/
      src/forms/
      src/tables/
      src/overlays/
      src/layout/
  composition/
    src/catalog/             Generated official module bindings
    src/presets/             Product defaults, initial roles and grants

modules/
  contacts/
  projects/
  orders/
  inventory/
    module.ts                Discoverable public definition
    domain/                  Pure business rules where needed
    server/                  Authoritative operations
    local/                   Standalone handlers where supported
    web/                     Custom views where needed
    releases/                Retained compatible release entry points

tooling/
  modules/                   CLI, discovery, review and development host
  build/
  database/
  verification/
tests/
  integration/
  e2e/
  desktop/
  fixtures/
docs/
```

The module subtree illustrates supported responsibilities, not mandatory empty directories. Simple modules remain simple. Shared-shell feature folders own their UI, state and feature styles together; generic visual primitives belong to `ui/web`.

## Dependency rules

1. Apps assemble the shell, client/server services, adapters and product composition. Reusable packages do not import apps.
2. SDK authoring and platform contracts do not import concrete business modules, the product catalog, React, PostgreSQL or Electron. Separate environment-specific SDK exports remain explicit.
3. Business modules depend on public SDK contracts and approved UI APIs. Cross-module execution uses declared services and grants. Module implementations do not import private server storage.
4. The client owns client-side state and execution; the server owns authoritative state and execution. They share contracts, not implementation imports.
5. Product composition owns bundled modules, role presets and onboarding defaults, and injects them into hosts. The runtime receives a catalog interface rather than importing the product catalog.
6. The shell uses client capabilities and UI components. UI primitives do not depend on shell, server or business modules. Schema-driven UI may use browser-safe SDK contracts.
7. Electron capabilities remain behind preload IPC. Organizing code must preserve credential, lease, signature, permission and transaction checks.
8. Private imports and cycles are checked for every discovered workspace/module. Remove hard-coded business-module lists and enforce browser, Node, preload and worker dependency environments.

Physical directories and package identifiers are separate decisions. First move `module-sdk` to `sdk`, `app-web` to `shell`, `ui-web` to `ui/web`, and `design-tokens` to `ui/tokens` while retaining working public identifiers. Consolidate `api-client` and `platform` under `client`, and reorganize `server-core` under `server`, in separately reviewable steps. Decide public identifier changes explicitly and update CLI scaffolding, generated contracts and module fixtures together. Existing signed releases retain their identities, hashes and compatibility behavior; do not rewrite them as part of a naming cleanup.

## Migration sequence and acceptance

| Step | Work | Acceptance |
| --- | --- | --- |
| ARCH-01 | Record target ownership, current dependencies and exceptions. | Reviewable layout and explicit boundary rules. This document proposes them; migration is not complete. |
| ARCH-02 | Mechanical directory moves and feature grouping. Update workspace globs, package exports, generators, build paths, CI paths and documentation. | Strict typecheck, boundary checks and all application builds; existing public imports still resolve. |
| ARCH-03 | Separate contracts from product assembly; replace concrete catalog imports with injected interfaces; isolate retained legacy business adapters. | Generic SDK/runtime paths do not depend on Orders/Inventory; historical data and retry compatibility remain intact. |
| ARCH-04 | Extract cohesive profile, installation, runtime, administration and shell responsibilities. Keep transaction orchestration explicit. | Focused business, authorization, lease, retry and atomicity regression checks. No incidental UI redesign. |
| ARCH-05 | Enforce all-package boundaries and environment-specific TypeScript configurations. Reorganize fixtures and checks by responsibility. | Dependency/cycle failures are actionable; independently scaffold/build/install a module without host edits. |
| ARCH-06 | Verify end-to-end behavior and reconcile tracker/evidence. | Headless browser and hidden/minimized native journeys; inspect relevant screenshots; then resume feature-parity expansion. |

Do not combine structural moves, public API redesign and visual redesign in one change. Do not add layers with no present responsibility. Unit tests may live beside their owner; multi-package integrations and user journeys remain in the root test suites. Historical verification artifacts remain at stable paths.

## Preserved work and verification state

The local-services feature remains uncommitted in the working tree. Its new typed service contracts, profile grants, worker transactions, UI and tests must be preserved through structural work. It has 250 passing unit/PostgreSQL tests and two passing focused browser journeys. The broader browser run completed with 15 passes and one accessibility failure involving a closing Select popup underneath the service-consent dialog; isolate the timing/visibility cause before claiming acceptance. The new native journey has not run. No additional tests were launched for this architecture review.

The feature-parity goal remains incomplete. This architecture reconciliation takes execution priority; UI refinement remains a separate later goal.
