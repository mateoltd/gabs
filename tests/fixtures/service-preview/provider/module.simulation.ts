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
