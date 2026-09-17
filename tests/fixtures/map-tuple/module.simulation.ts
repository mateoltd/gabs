import { defineSimulationModule } from "@suite/module-sdk/simulator";
import module from "./module";
export default defineSimulationModule(module, {
  records: {
    targets: Array.from({ length: 105 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, "0")}`,
      data: { name: `Target ${String(i + 1).padStart(3, "0")}` },
    })),
  },
});
