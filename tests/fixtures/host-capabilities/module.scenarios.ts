import assert from "node:assert/strict";
import { defineModuleScenarios } from "@suite/module-sdk/scenarios";
import module from "./module";

export default defineModuleScenarios(module, {
  hostResults: { export: { status: "cancelled" } },
  scenarios: {
    "simulates a changed export outcome": async (simulation) => {
      const input = { filename: "notes.txt", content: "Scenario fixture" };
      assert.deepEqual(await simulation.host.call("export", input), {
        status: "cancelled",
      });
      simulation.setHostResult("export", { status: "saved" });
      assert.deepEqual(await simulation.host.call("export", input), {
        status: "saved",
      });
      assert.equal(simulation.snapshot().hostActions.length, 2);
      assert.equal(simulation.snapshot().audits.length, 0);
    },
    "starts fresh and rejects revoked or offline calls": async (simulation) => {
      const input = { filename: "notes.txt", content: "Scenario fixture" };
      assert.equal(simulation.snapshot().hostActions.length, 0);
      assert.deepEqual(await simulation.host.call("export", input), {
        status: "cancelled",
      });
      simulation.setPermissions(
        module.permissions.filter(
          (permission) => permission !== "custom-notes.export",
        ),
      );
      await assert.rejects(simulation.host.call("export", input), {
        code: "FORBIDDEN",
      });
      simulation.setPermissions([...module.permissions]);
      simulation.setOnline(false);
      await assert.rejects(simulation.host.call("export", input), {
        code: "OFFLINE",
      });
      assert.equal(simulation.snapshot().journal.length, 0);
    },
  },
});
