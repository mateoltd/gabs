import { defineModuleServer } from "@suite/module-sdk/server";
import module from "./module";
export default defineModuleServer(module)({
  capture: async (ctx, input) => {
    const record = await ctx.resource("notes").create(input);
    return { id: record.id };
  },
});
