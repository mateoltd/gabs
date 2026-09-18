import assert from "node:assert/strict";
import { defineModuleScenarios } from "@suite/module-sdk/scenarios";
import module from "./module";
export default defineModuleScenarios(module, {
  hostLeases: { export: { remainingMs: 60000 } },
  scenarios: {
    "keeps lease states distinct and online-only actions authoritative": async (
      simulation,
    ) => {
      const input = { filename: "notes.txt", content: "Fixture" };
      simulation.setOnline(false);
      assert.equal(
        (await simulation.host.call("export", input)).status,
        "cancelled",
      );
      await assert.rejects(
        simulation.host.call("notify", { title: "Notice", message: "Fixture" }),
        { code: "OFFLINE" },
      );
      simulation.advanceHostTime(60000);
      await assert.rejects(simulation.host.call("export", input), {
        code: "LEASE_EXPIRED",
      });
      simulation.setOnline(true);
      simulation.grantHostLease("export");
      simulation.revokeHostLease("export");
      simulation.setOnline(false);
      await assert.rejects(simulation.host.call("export", input), {
        code: "LEASE_REVOKED",
      });
      assert.equal(simulation.snapshot().journal.length, 0);
    },
    "starts fresh and rechecks a delayed effect": async (simulation) => {
      assert.equal(simulation.snapshot().hostElapsedMs, 0);
      simulation.setOnline(false);
      const delayed = simulation.prepareHost("export", {
        filename: "notes.txt",
        content: "Fixture",
      });
      simulation.advanceHostTime(60000);
      await assert.rejects(delayed.complete(), { code: "LEASE_EXPIRED" });
      assert.equal(simulation.snapshot().hostActions[0].state, "rejected");
      assert.equal(simulation.snapshot().audits.length, 0);
    },
  },
});
