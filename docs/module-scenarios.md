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

Each scenario starts with fresh records, journal, receipts, events, permissions and online state. Explicit `fixtures` override `fixtures.json`; otherwise the CLI loads that file from the module directory. Fixtures are validated against the same resource schemas. Use `configuration` for required configuration and `server` for a scoped handler imported from your own `module-server.ts`; its contract must match the selected release exactly. Shared mutable state captured by author functions is still the author's responsibility.

The simulation exposes `setOnline`, `setPermissions`, `submit`, `sync`, `snapshot`, and the normal typed `client`. `client` performs immediate simulated requests; use `submit` to exercise provisional offline captures. [Contacts scenarios](../modules/contacts/module.scenarios.ts) demonstrate rejected offline work and conflicting edits. Assertions may use Node's built-in `node:assert/strict`; no test-framework globals are required.

```sh
pnpm module check contacts
pnpm module test contacts
pnpm module check ./path/to/module --dependency ./path/to/provider
pnpm module test ./path/to/module --dependency ./path/to/provider
```

`check` and `test` accept directories without catalog or host edits. They type-check the module source graph, validate fixture schemas, resolve compatible dependencies and build custom client views to catch unsupported imports or invalid bundles. Repeat `--dependency` for additional development provider directories. This supplies dependency metadata for compatibility checks; it does not yet inject cross-module services into the simulator. With no module argument, `check` checks every discovered module; `test` requires an explicit target.

The scenario process reports `RUN`, `PASS` or `FAIL` with the module and scenario name, plus assertion stacks. Ordinary failures do not prevent independent scenarios from running. The CLI terminates a stuck scenario process after 120 seconds and exits unsuccessfully; the last `RUN` line identifies where it stopped. Author files are trusted development code, not sandboxed extensions.

## Verification boundary

These scenarios help module authors iterate. The current simulator does not implement private stores, corporate audit storage, cross-module service fixtures, production authorization, durable persistence or historical field merging. Standalone resource simulation is available through `personal: true`; executing a custom local handler still belongs to the actual local worker tests. Keep PostgreSQL, browser and native acceptance for those behaviors. The [custom React development preview](module-development.md) has separate local acceptance. Cross-module fixtures and private-store/audit simulation remain SDK-03 work; this command does not imply those capabilities are complete.
