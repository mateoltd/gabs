import { defineModuleServer } from "@suite/module-sdk/server";
import module from "./module";
export default defineModuleServer(module)({
  capture: async (ctx, input) => {
    const record = await ctx.resource("notes").create({ name: input.name });
    await ctx.emit("captured", { name: input.name });
    if (input.fail) ctx.reject({ reason: "cancelled" });
    return { id: record.id };
  },
});
