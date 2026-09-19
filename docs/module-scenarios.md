# Module-owned development scenarios

`pnpm module test <module-id-or-directory>` checks the selected module and runs its own `module.scenarios.ts`. Missing or empty scenarios fail. The command no longer substitutes the host's generic SDK tests for module behavior.

```ts
import assert from "node:assert/strict";
import { defineModuleScenarios } from "@suite/module-sdk/scenarios";
import module from "./module";

export default defineModuleScenarios(module, {
  fixtures: { items: [{ name: "Office printer" }] },
  scenarios: {
    "denies a write after permissions change": async (simulation) => {
      simulation.setPermissions([`${module.id}.items.read`]);
      await assert.rejects(
        simulation.client.resource("items").create({ name: "Denied" }),
        { code: "FORBIDDEN" },
      );
      const page = await simulation.client.resource("items").list();
      assert.equal(page.items.length, 1);
    },
  },
});
```

Adapt the example to your resource names and fields. Resource names, inputs, results, fixtures and configuration are inferred from the imported module. Normal TypeScript diagnostics include the source file, line and column. Scaffolding writes working examples for the generated `items` resource.

Each scenario starts with fresh root/provider records, private stores, journal, receipts, events, simulated audits, grants, permissions and online state. Explicit `fixtures` override `fixtures.json`; otherwise the CLI loads that file from the module directory. Fixtures are validated against the same resource schemas. Use `configuration` for required configuration and `server` for a scoped handler imported from your own `module-server.ts`; its contract must match the selected release exactly. Shared mutable state captured by author functions is still the author's responsibility.

The simulation exposes `setOnline`, `setPermissions`, `submit`, `sync`, `snapshot`, and the normal typed `client`. Ordinary client writes perform immediate simulated requests; use resource `queue` methods or `client.queue` for typed provisional capture, or `submit` for preview-style offline capture. Captures share the host’s same-record and nested-reference scheduling rules, reject cycles before changing the journal and preserve exact retry identities regardless of prerequisite order. A conflict holds its dependents while unrelated work continues; see [scheduling acceptance](verification/simulation-order/README.md). [Contacts scenarios](../modules/contacts/module.scenarios.ts) demonstrate rejected offline work and conflicting edits. Assertions may use Node's built-in `node:assert/strict`; no test-framework globals are required.

```sh
pnpm module check contacts
pnpm module test contacts
pnpm module check ./path/to/module --dependency ./path/to/provider
pnpm module test ./path/to/module --dependency ./path/to/provider
```

`check` and `test` accept directories without catalog or host edits. They type-check the module source graph, validate fixture schemas, resolve compatible dependencies and build custom client views to catch unsupported imports or invalid bundles. Repeat `--dependency` for additional development provider directories. For `test`, these directories also supply provider backends, configuration and fixtures. Compatibility alone never grants service access. With no module argument, `check` checks every discovered module; `test` requires an explicit target.

The scenario process reports `RUN`, `PASS` or `FAIL` with the module and scenario name, plus assertion stacks. Ordinary failures do not prevent independent scenarios from running. The CLI terminates a stuck scenario process after 120 seconds and exits unsuccessfully; the last `RUN` line identifies where it stopped. Author files are trusted development code, not sandboxed extensions.

## Cross-module fixtures

Use an optional `module.simulation.ts` in each development module. It is trusted development code and is not shipped as a release entry. `defineSimulationModule` infers private-store and identified-resource fixture types, validates their schemas and rejects duplicate/invalid IDs. Keep the existing `fixtures.json` format for simple resource examples with generated IDs.

```ts
// provider/module.simulation.ts
import { defineSimulationModule } from "@suite/module-sdk/simulator";
import module from "./module";

export default defineSimulationModule(module, {
  configuration: { prefix: "Verified " },
  stores: {
    entries: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        data: { name: "Initial provider fixture" },
      },
    ],
  },
});
```

Use your own store and configuration fields. `records` accepts resource fixtures with stable IDs, optional versions and archive state in the same envelope. Cross-module links can reference those stable IDs. The CLI loads `module-server.ts` automatically and checks its exact scoped contract. A simulation file can override the file-based configuration, simple fixtures and backend explicitly.

```ts
// consumer/module.simulation.ts
import {
  defineSimulationModule,
  grantSimulationServices,
} from "@suite/module-sdk/simulator";
import module from "./module";

export default defineSimulationModule(module, {
  grants: grantSimulationServices(module, "record"),
});
```

Only declared service aliases are accepted by the typed grant helper. The simulator checks the loaded provider's version, public contract, explicit grant and actor permissions when executing a service. Provider calls share the caller's actor, workspace and transaction. Explicitly translated business rejections preserve the consumer's declared error type; ignored dependent failures still roll back the transaction.

For direct SDK use, pass `providers: [defineSimulationModule(provider, {...})]` and `grants` to `createModuleSimulator` or `defineModuleScenarios`. CLI scenarios inherit `module.simulation.ts`, configuration/fixtures files and the supplied provider directories; explicitly supplied scenario options override those defaults. Every scenario receives a fresh graph. Inspect it with `simulation.inspect(provider)` for inferred record types, `snapshot()` for journal/effects, `setModulePermissions(provider.id, [...])` and `setGrants([...])` to exercise revocation.

[The independent service-preview fixture](../tests/fixtures/service-preview/module.scenarios.ts) is executable:

```sh
pnpm module test tests/fixtures/service-preview --dependency tests/fixtures/service-preview/provider
pnpm module dev tests/fixtures/service-preview --dependency tests/fixtures/service-preview/provider
```

## Reference fixtures

Public resource clients expose `.references(query, { signal })` and the form-compatible `.loadReferences`. Reference queries need explicit member and cross-module read fixtures, independently of service grants:

```ts
export default defineSimulationModule(module, {
  readGrants: [{ consumerId: module.id, providerId: "contacts" }],
  members: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Alex",
      active: true,
      userActive: true,
    },
  ],
});
```

The consumer must declare the provider dependency, and the provider must be loaded at a compatible version. `simulation.setReadGrants(...)`, `setMembers(...)` and `setModulePermissions(...)` exercise revocation. Member IDs must be unique; inactive members/accounts and archived resource records are omitted. No corporate member is fabricated from the simulator actor. Source and target read permissions are required on every lookup.

The development workspace exposes read grants under **Module grants and provider permissions**. Reload restores file-based fixtures. Offline corporate queries fail without journaling; `personal: true` permits same-module standalone targets and rejects corporate membership or cross-module targets. Creates and updates validate present links against these same permissions, grants and active targets. Missing or archived targets reject the whole transaction. Offline captures remain provisional until synchronization validates them. Seed fixtures may deliberately contain historical or invalid links for recovery scenarios; loading fixtures does not act as an accepted business write.

## Host capability fixtures

Modules declaring [host capabilities](module-host-capabilities.md) can configure inferred adapter results in `module.simulation.ts` or scenario options:

```ts
import { defineSimulationModule } from "@suite/module-sdk/simulator";
import module from "./module";

export default defineSimulationModule(module, {
  hostResults: {
    export: { status: "cancelled" },
    notify: { requested: true },
  },
});
```

Use the aliases declared by your module. Wrong aliases/result types fail compilation, and imported fixtures are also runtime-validated. `simulation.host.call(alias, input)` shares the public client's inferred input/result contract. `simulation.setHostResult(alias, result)` changes a fixture; `undefined` restores its default. Results, snapshots and fixture inputs are cloned so callers cannot mutate the configured state accidentally.

Defaults simulate a browser export being offered, unavailable notifications and disabled LAN status. Relay requires an explicit `{ relayed: true, authoritative: false }` fixture. These are response simulations; no filesystem, notification or network adapter runs. Corporate host calls reject revoked permissions. Offline use requires an explicitly lease-enabled declaration and a valid simulated allowance; host calls never enter the operation journal. Standalone handlers use the separate [device request simulator](local-device-simulation.md).

Each scenario begins with fresh host fixtures and observations. `snapshot().hostActions` records up to 100 simulated/rejected results without export content or relay payloads. The independently authored [host scenarios](../tests/fixtures/host-capabilities/module.scenarios.ts) verify changed outcomes, fresh state, permission revocation and offline rejection:

```sh
pnpm module test tests/fixtures/host-capabilities
pnpm module dev tests/fixtures/host-capabilities
```

## Corporate offline lease scenarios

Only aliases declaring `offline: "lease"` accept `hostLeases` fixtures or `grantHostLease` calls. A fixture describes a development allowance for the exact loaded module; it is not a signed credential. Omitted aliases begin missing, and a zero remaining lifetime begins expired. Durations are integer milliseconds from 0 through 24 hours.

```ts
export default defineSimulationModule(module, {
  hostLeases: { export: { remainingMs: 60_000 } },
});
```

Use `simulation.setOnline(false)` and the ordinary inferred `simulation.host.call("export", input)` to exercise offline behavior. Online-only declarations still reject disconnected calls. The following controls are available in direct tests and module-owned CLI scenarios:

- `grantHostLease(alias, remainingMs = 86_400_000)` renews an allowance only while the simulated company server is online and current capability/view permissions allow it.
- `revokeHostLease(alias)` applies a known local revocation. Changing the observed root-module permission set also invalidates existing allowances; restoring a permission alone does not renew a lease.
- `advanceHostTime(milliseconds)` advances a deterministic clock without wall-clock delays. It affects host allowances only, leaving business dates and operation journals unchanged.
- `prepareHost(alias, input)` returns an inferred `{ complete() }` action for delayed-effect scenarios. Complete it after advancing time or changing permissions to verify rejection. An offline action cannot silently switch to a replacement lease; completion is single-use.
- `snapshot().hostLeases` distinguishes missing, valid, expired and revoked allowances with remaining milliseconds. Host action observations identify online versus leased authorization.

An online host call uses current simulated server authorization, even if its old offline allowance expired. A successful online call does not automatically renew that allowance. Setting permissions represents a policy change already observed by the client; the simulator does not pretend disconnected devices instantly learn remote revocations. Corporate lease fixtures are rejected in personal simulations.

Every new scenario or source reload resets the clock, observations and allowances to the declared fixtures. Run the independently authored examples:

```sh
pnpm module test tests/fixtures/corporate-lease-simulation
pnpm module dev tests/fixtures/corporate-lease-simulation
```

These fixtures model author-visible outcomes. Actual signatures, issuer rotation, encrypted persistence, profile recovery, HTTP failure classification and file-dialog effects retain their separate browser/native acceptance.

## Verification boundary

These scenarios help module authors iterate. Private stores, service calls and simulated audit entries run in serialized in-memory transactions. This does not establish PostgreSQL concurrency/isolation, database locale and exact numeric behavior, corporate authorization, durable persistence or historical field merging. Standalone resource simulation is available through `personal: true`; actual local workers retain their separate browser/native acceptance. Keep PostgreSQL, browser and native acceptance for their own behaviors. [The SDK-03 acceptance map](verification/module-services-preview/README.md) ties the scenario, preview and provider evidence together.
