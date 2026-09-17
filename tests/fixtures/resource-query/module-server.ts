import { defineModuleServer } from "@suite/module-sdk/server";
import module from "./module";
export default defineModuleServer(module)({
  approved: async (ctx, input) => {
    const page = await ctx.resource("records").list({
      where: { approved: true },
      ranges: { amount: { gte: input.minimum } },
      orderBy: [{ field: "amount", direction: "desc" }],
      limit: 2,
      cursor: input.cursor,
    });
    return {
      names: page.items.map((row) => row.data.name),
      nextCursor: page.nextCursor,
    };
  },
});
