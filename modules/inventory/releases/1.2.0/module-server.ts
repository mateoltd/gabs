import { defineTrustedModuleServer } from "@suite/module-sdk/server";
import { requireCondition, type Tx, type Context } from "@suite/server-core";
import module from "./module";
import {
  createProduct,
  listProducts,
  changeStock,
  countStock,
} from "../../server/index";
type Runtime = { tx: Tx; ctx: Context };
export default defineTrustedModuleServer(module)<Runtime>({
  count: ({ tx, ctx }, input) => countStock(tx, ctx, input),
  products: ({ tx, ctx }) => listProducts(tx, ctx, {}),
  "create-product": ({ tx, ctx }, input) => createProduct(tx, ctx, input),
  stock: ({ tx, ctx }, { id, ...input }) => {
    requireCondition(
      ctx.permissions.includes(
        input.kind === "receipt" ? "inventory.receive" : "inventory.adjust",
      ),
      403,
      "FORBIDDEN",
      "Your role does not allow this stock change.",
    );
    return changeStock(tx, ctx, id, input);
  },
});
