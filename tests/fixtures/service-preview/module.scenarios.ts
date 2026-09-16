import assert from "node:assert/strict";
import { defineModuleScenarios } from "@suite/module-sdk/scenarios";
import provider from "./provider/module";
import module from "./module";
export default defineModuleScenarios(module, {
  scenarios: {
    "provider fixtures and shared effects": async (simulation) => {
      assert.equal(simulation.inspect(provider).stores.entries.length, 1);
      await simulation.client.call("capture", {
        name: "Module-owned scenario",
      });
      assert.deepEqual(await simulation.client.call("names", {}), [
        "Verified Module-owned scenario",
      ]);
      assert.equal(simulation.inspect(provider).stores.entries.length, 2);
      assert.equal(simulation.snapshot().events[0].moduleId, provider.id);
      simulation.setGrants([]);
      await assert.rejects(
        simulation.client.call("capture", { name: "Denied" }),
        { code: "GRANT_REQUIRED" },
      );
      assert.equal(simulation.inspect(provider).stores.entries.length, 2);
    },
    "fresh provider fixtures per scenario": async (simulation) => {
      assert.equal(simulation.inspect(provider).stores.entries.length, 1);
      assert.deepEqual(await simulation.client.call("names", {}), []);
    },
  },
});
