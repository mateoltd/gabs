import { defineModuleServer } from "@suite/module-sdk/server";
import module from "./module";
export default defineModuleServer(module)({
  echo: async (context, input) => {
    await context.resource("records").create(input);
    return input.email === "bad-output@example.com"
      ? { ...input, date: "2025-02-29" }
      : input;
  },
});
