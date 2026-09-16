import { defineModuleServer } from "@suite/module-sdk/server";
import module from "./module";
export default defineModuleServer(module)({
  record: async (ctx, input) => {
    const record = await ctx.store("entries").create(input);
    await ctx.audit("recorded", record.id);
    await ctx.emit("recorded", input.name);
    return ctx.configuration.prefix + input.name;
  },
});
