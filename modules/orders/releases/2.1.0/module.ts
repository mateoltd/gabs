import { defineModule, capability } from "@suite/module-sdk";
import previous from "../2.0.0/module";
/** Business/storage contracts remain compatible; device effects are now manifest-declared. */
export default defineModule({
  ...previous,
  version: "2.1.0",
  capabilities: {
    export: capability({ kind: "files.export", permission: "orders.export" }),
  },
});
