# Architecture reconciliation

Status: implemented, committed and locally accepted. The initial migration was verified on 17 September 2026; subsequent reviews are recorded in the [architecture evidence](verification/architecture/README.md). This reconciliation addresses the user's architecture feedback. Product scope and the later UI-refinement goal remain unchanged.

## Historical baseline diagnosis

Before the migration, the directory structure reflected incremental implementation more than stable ownership:

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

composition/                 Outermost product assembly, not a reusable package
  src/catalog/               Generated official module bindings
  src/presets/               Product defaults, initial roles and grants
  src/web/                   Product shell views and navigation

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

| Step    | Work                                                                                                                                            | Acceptance                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| ARCH-01 | Record target ownership, current dependencies and exceptions.                                                                                   | Reviewable layout and explicit boundary rules.                                                                             |
| ARCH-02 | Mechanical directory moves and feature grouping. Update workspace globs, package exports, generators, build paths, CI paths and documentation.  | Strict typecheck, boundary checks and all application builds; existing public imports still resolve.                       |
| ARCH-03 | Separate contracts from product assembly; replace concrete catalog imports with injected interfaces; isolate retained legacy business adapters. | Generic SDK/runtime paths do not depend on Orders/Inventory; historical data and retry compatibility remain intact.        |
| ARCH-04 | Extract cohesive profile, installation, runtime, administration and shell responsibilities. Keep transaction orchestration explicit.            | Focused business, authorization, lease, retry and atomicity regression checks. No incidental UI redesign.                  |
| ARCH-05 | Enforce all-package boundaries and environment-specific TypeScript configurations. Reorganize fixtures and checks by responsibility.            | Dependency/cycle failures are actionable; independently scaffold/build/install a module without host edits.                |
| ARCH-06 | Verify end-to-end behavior and reconcile tracker/evidence.                                                                                      | Headless browser and hidden/minimized native journeys; inspect relevant screenshots; then resume feature-parity expansion. |

Do not combine structural moves, public API redesign and visual redesign in one change. Do not add layers with no present responsibility. Unit tests may live beside their owner; multi-package integrations and user journeys remain in the root test suites. Historical verification artifacts remain at stable paths.

## Implemented ownership and compatibility decisions

The [20 September release-recovery review](verification/architecture/README.md#release-recovery-checkpoint-review-20-september-2026) preserves this hierarchy and records the requested checkpoint, Sol xhigh delegation and independent parent acceptance. It keeps release-selection recovery in server registry services, with transaction orchestration at the API boundary and presentation in the shell.

- `composition/` is at the repository root because it is the outermost application assembly. It owns the generated bundled-module catalog, role and workspace presets, server bindings, local runtime assembly and product shell views. Placing it under `packages/` would imply that generic packages may depend on it. Hosts inject explicit catalog and shell composition objects; reusable client, server, shell and contract code does not import product assembly.
- Physical package paths now express responsibility: `sdk`, `client`, `server`, `shell`, `ui/web` and `ui/tokens`. Existing published package identifiers such as `@suite/module-sdk`, `@suite/app-web` and `@suite/ui-web` remain compatible. The former API-client and platform implementations are one `@suite/client` package because they share browser storage, local execution and transport ownership.
- The SDK index is a composition surface. Authoring, client, contract, runtime, testing and documentation code lives in named subdirectories. The stable `./local` and `./server` exports remain as narrow compatibility barrels while the implementations live under `runtime` and `authoring`.
- Durable workspace synchronization belongs to `client/src/modules/synchronization.ts`. The shell owns React scheduling and one typed host-policy adapter shared by automatic scheduling and explicit retries; execution does not import the shell. The [19 September review](verification/architecture/README.md#synchronization-ownership-review-19-september-2026) records this correction.
- Standalone encrypted profiles use `client/src/identity/local-vault/`: `index.ts` coordinates the profile lifecycle, `store.ts` owns typed IndexedDB access and change notifications, and `crypto.ts` owns WebCrypto operations. This internal split preserves the existing database format and public profile API. The subsequent PIN implementation adds optional credential metadata to the existing vault row without a database-version migration; the [feature evidence](verification/local-profile-unlock/README.md) records its cryptographic and lifecycle guarantees.
- Client, server and shell runtimes receive required composition objects. Registration remains in application assembly; reusable server consumers only require a read-only `ModuleCatalog`. Missing composition is a compile-time error rather than a process-global initialization state.
- Discovery regenerates imports through module public entries and synchronizes every discovered bundled module into `composition/package.json`. Adding a fifth module does not require editing host source. The generated composition file is the only reviewed assembly surface allowed to bind discovered module entries.
- Orders uses SDK services for current cross-module work. `modules/orders/server/legacy-inventory-adapter.ts` is the sole direct Orders-to-Inventory implementation exception, retained for version-1 signed receipts and historical recovery. The boundary checker matches that exact adapter rather than granting modules general access to one another.
- Existing signed artifacts, package identities, host revisions and desktop output names remain unchanged. Generated OpenAPI JSON is byte-identical to the checkpoint, as are the generated API declarations and design-token values.
- Tests are grouped into `unit`, `integration` and `support`; browser, desktop and fixture paths remain stable. [The test layout](../tests/README.md) records the responsibility rule and the old-to-new path mapping without rewriting historical evidence links.

## Enforced dependency and environment proof

`tooling/verification/check-boundaries.mjs` resolves TypeScript, dynamic import and CSS edges across every workspace, module and root assembly. It rejects unresolved internal paths, private cross-package imports, undeclared relative or package dependencies, package cycles and illegal layer direction. Type-only `import()` edges are included. Browser, worker, preload and Node graphs are checked transitively with separate TypeScript configurations.

The integration fixtures prove rejection of an indirect browser-to-Node edge, Node package subpaths, worker-to-DOM edges, undeclared module-private imports, private relative app imports, module-to-server internals and contracts-to-product assembly. They also prove that public type-only module contracts and Node-based Vite configuration remain legal. The parent review's seven independent adversarial probes passed without checker-specific exceptions.

## UI and wire continuity

No visual declarations changed. Eight of the nine baseline CSS files are byte-identical at their new locations. The shared UI stylesheet changes only four `@import` paths, in the original order; the module-development host stylesheet likewise uses public stylesheet exports in the same order. All 16 named component implementations extracted from the former UI index have identical TypeScript-printed function bodies. Headless browser and minimized native acceptance passed after the fixture-path corrections recorded in the verification report.

Regeneration preserves the frozen interfaces exactly: `docs/openapi.json`, `packages/client/src/api/schema.d.ts` and `packages/ui/tokens/src/values.ts` compare byte-for-byte with checkpoint `69aa1a3`. Desktop builds continue to emit `dist/main.cjs`, `dist/preload.cjs`, `dist/cache-worker.cjs` and `dist/renderer`.

## Preserved work and verification state

Checkpoint `69aa1a3` contained the then-uncommitted local-services feature: typed service contracts, encrypted profile grants, worker transactions, UI and tests. That was the migration baseline, including its known intermittent accessibility failure while a Select popup completed its exit underneath the consent dialog. The structural work preserved the feature and its transaction, security and offline behavior. Acceptance identified the popup as still exposed to accessibility and interaction checks after Base UI had closed it; the popup is now `aria-hidden` and inert only while closed, with its existing exit animation retained. Three repeated local-services, keyboard/focus, motion, responsive and high-contrast runs passed all 36 cases, and the new minimized native local-services journey passed.

The complete local suite passed 257 unit/PostgreSQL tests across 56 files. The broad browser run passed 99 of 111 cases; all 12 failures were stale test routes for the renamed composition worker entry. Those 12 cases passed after their fixtures were corrected. A later focused run found the Select accessibility race, followed by the 36-case repeat above. The initial selected native run passed 10 of 13 cases; its three stale/default-fixture failures passed in a four-case repair run together with the second boundary case. All four production builds, strict environment checks, frozen lockfile installation and grouped CLI/distribution checks passed. [The detailed acceptance record](verification/architecture/README.md) keeps the run-by-run results rather than presenting them as one uninterrupted clean suite.

The feature-parity goal remains incomplete. Architecture reconciliation is locally accepted; feature-parity expansion may resume after the repository checkpoint. UI refinement remains a separate later goal.

The [26 September organization review](verification/architecture/README.md#organization-diagnostics-checkpoint-review-26-september-2026) retains the hierarchy and separates portable governance schemas, graph rules and permission evaluation behind the stable SDK public entry. The shell owns diagnostics and repair interaction; server validation remains authoritative. This is a cohesive internal split, without new workspace packages or public identifier changes.
