import { defineSimulationModule } from "@suite/module-sdk/simulator";
import module from "./module";
export default defineSimulationModule(module, {
  personal: true,
  deviceAccess: ["export"],
  hostResults: { export: { status: "cancelled" } },
});
