import assert from "node:assert/strict";
import { defineModuleScenarios } from "@suite/module-sdk/scenarios";
import module from "./module";
export default defineModuleScenarios(module, {
  scenarios: {
    "offline capture and configured device outcome": async (simulation) => {
      simulation.setOnline(false);
      const id = await simulation.localClient.call("capture", {
        text: "CLI capture",
      });
      assert.equal(
        simulation.snapshot().local!.deviceRequests[0].state,
        "pending",
      );
      assert.deepEqual(await simulation.processDeviceRequest(id), {
        status: "cancelled",
      });
      assert.equal(
        (await simulation.localClient.resource("notes").list()).items.length,
        1,
      );
    },
    "interruption requires review and preserves one business record": async (
      simulation,
    ) => {
      const id = await simulation.localClient.call("capture", {
        text: "CLI recovery",
      });
      await simulation.processDeviceRequest(id, { interrupt: true });
      simulation.lockProfile();
      simulation.unlockProfile();
      assert.throws(() => simulation.retryDeviceRequest(id), /Review/);
      const retry = simulation.retryDeviceRequest(id, {
        confirmUncertain: true,
      });
      await simulation.processDeviceRequest(retry);
      assert.equal(simulation.snapshot().records.notes.length, 1);
      assert.equal(simulation.snapshot().local!.deviceRequests.length, 2);
    },
  },
});
