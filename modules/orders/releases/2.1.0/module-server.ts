import type { ScopedModuleServer } from "@suite/module-sdk/server";
import previous from "../2.0.0/module-server";
import module from "./module";
/** This release adds no business operations or schema changes; retain their reviewed implementation. */
export default Object.freeze({
  ...previous,
  module,
}) satisfies ScopedModuleServer;
