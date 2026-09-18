import { defineSimulationModule } from "@suite/module-sdk/simulator";
import module from "./module";
export default defineSimulationModule(module, {
  hostLeases: { export: { remainingMs: 60000 } },
  hostResults: { export: { status: "cancelled" } },
});
