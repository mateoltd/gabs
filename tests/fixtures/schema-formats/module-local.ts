import { defineLocalModule } from "@suite/module-sdk/local";
import module from "./module";
export default defineLocalModule(module)({
  capture: async (context, input) => {
    await context.resource("records").create(input);
    return input;
  },
});
