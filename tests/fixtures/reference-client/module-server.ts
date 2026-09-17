import { defineModuleServer } from "@suite/module-sdk/server";
import module from "./module";
export default defineModuleServer(module)({
  lookup: (ctx, input) => ctx.resource("notes").references(input),
});
