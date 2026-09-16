import {
  defineSimulationModule,
  grantSimulationServices,
} from "@suite/module-sdk/simulator";
import module from "./module";
export default defineSimulationModule(module, {
  grants: grantSimulationServices(module, "record"),
});
