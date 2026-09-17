import { defineSimulationModule } from "@suite/module-sdk/simulator";
import module from "./module";
const target = (i: number) =>
  `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
export default defineSimulationModule(module, {
  records: {
    targets: Array.from({ length: 105 }, (_, index) => ({
      id: target(index + 1),
      data: { name: `Target ${String(index + 1).padStart(3, "0")}` },
    })),
    records: Array.from({ length: 10 }, (_, index) => ({
      id: target(201 + index),
      data: {
        name: index === 0 ? "Nested record" : `Linked record ${index + 1}`,
        pair: [target(105 - index), 0],
        links: { "a/b~c": target(105 - index) },
        extras: {
          fixed: "kept",
          ...Object.fromEntries([["supplier", target(104)]]),
        },
      },
    })),
  },
});
