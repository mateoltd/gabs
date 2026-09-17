import { defineModule, operation, Type } from "@suite/module-sdk";
import { defineLocalModule } from "@suite/module-sdk/local";
import base from "./local-capabilities";

export const module = defineModule({
  ...base,
  operations: {
    capture: operation({
      title: "Capture and export",
      policy: "local",
      permission: "device-notes.export",
      input: Type.Object({
        text: Type.String(),
        reject: Type.Optional(Type.Boolean()),
        count: Type.Optional(Type.Integer({ minimum: 1, maximum: 17 })),
      }),
      output: Type.String(),
      errors: Type.Object({ reason: Type.Literal("blocked") }),
    }),
  },
});
export default defineLocalModule(module)({
  async capture(ctx, input) {
    await ctx.resource("notes").create({ name: input.text });
    let id = "";
    for (let index = 0; index < (input.count ?? 1); index++)
      id = await ctx.device.request("export", {
        filename: "notes.txt",
        content: input.text,
      });
    if (input.reject) ctx.reject({ reason: "blocked" });
    return id;
  },
});
