import { defineSimulationModule } from "@suite/module-sdk/simulator";
import module from "./module";
export default defineSimulationModule(module, {
  records: {
    records: Array.from({ length: 7 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      data: {
        name: `Record ${String(index + 1).padStart(2, "0")}`,
        amount: index,
        approved: index % 2 === 0,
      },
    })),
    other: [
      {
        id: "00000000-0000-4000-8000-000000000008",
        data: { name: "Other record", amount: 100, approved: true },
      },
    ],
  },
});
