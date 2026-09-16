import { defineModuleServer } from "@suite/module-sdk/server";
import module from "./module";
export default defineModuleServer(module)({
  names: async (ctx) =>
    (await ctx.resource("notes").list()).items.map((row) => row.data.name),
  capture: async (ctx, input) => {
    const name = await ctx.service("record", input);
    const record = await ctx.resource("notes").create({ name });
    return { id: record.id };
  },
});
