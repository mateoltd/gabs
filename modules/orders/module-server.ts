import { defineTrustedModuleServer } from "@suite/module-sdk/server";
import type { Tx, Context } from "@suite/server-core";
import module from "./module";
import { createOrder, editOrder, changeOrder } from "./server/index";
type Runtime = { tx: Tx; ctx: Context };
export default defineTrustedModuleServer(module)<Runtime>({
  draft: ({ tx, ctx }, input) => createOrder(tx, ctx, input),
  edit: ({ tx, ctx }, { id, version, ...input }) =>
    editOrder(tx, ctx, id, input, JSON.stringify(String(version))),
  confirm: ({ tx, ctx }, input) =>
    changeOrder(
      tx,
      ctx,
      input.id,
      "confirm",
      JSON.stringify(String(input.version)),
    ),
  fulfill: ({ tx, ctx }, input) =>
    changeOrder(
      tx,
      ctx,
      input.id,
      "fulfill",
      JSON.stringify(String(input.version)),
    ),
  cancel: ({ tx, ctx }, input) =>
    changeOrder(
      tx,
      ctx,
      input.id,
      "cancel",
      JSON.stringify(String(input.version)),
    ),
});
