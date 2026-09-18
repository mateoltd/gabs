import { defineModuleServer } from "@suite/module-sdk/server";
import module from "./module";
export default defineModuleServer(module)({
  names: async (ctx) =>
    (await ctx.resource("notes").list()).items.map((row) => row.data.name),
  capture: async (ctx, input) => {
    if (input.name === "Reject this note") ctx.reject({ reason: "rejected" });
    const record = await ctx.resource("notes").create(input);
    return { id: record.id };
  },
});
