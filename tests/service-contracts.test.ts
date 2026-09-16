import { readFile } from "node:fs/promises";
import { format } from "prettier";
import { expect, it } from "vitest";
import { Type, type OperationContext } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import { serviceContractSource } from "../packages/module-sdk/node/service-contracts";
import inventory from "../modules/inventory/releases/2.0.0/module";
import orders from "../modules/orders/releases/2.0.0/module";
import snapshot from "../modules/orders/releases/2.0.0/inventory-services";

it("exports exactly the public provider contracts and detects a stale committed snapshot", async () => {
  const source = await format(serviceContractSource(inventory), {
    parser: "typescript",
  });
  expect(
    await readFile(
      "modules/orders/releases/2.0.0/inventory-services.ts",
      "utf8",
    ),
  ).toBe(source);
  expect(Object.keys(snapshot).sort()).toEqual([
    "consume",
    "release",
    "reserve",
    "resolve-products",
  ]);
  for (const [name, reference] of Object.entries(snapshot)) {
    expect(reference.moduleId).toBe(inventory.id);
    expect(reference.version).toBe(inventory.version);
    expect(canonical(reference.contract)).toBe(
      canonical(
        inventory.operations[name as keyof typeof inventory.operations],
      ),
    );
  }
  const changed = {
    ...inventory,
    operations: {
      ...inventory.operations,
      reserve: {
        ...inventory.operations.reserve,
        input: Type.Object({ newRequiredField: Type.String() }),
      },
    },
  };
  expect(serviceContractSource(changed)).not.toBe(
    serviceContractSource(inventory),
  );
});
it("fails with the operation and field path instead of exporting unsupported schemas with weakened types", () => {
  const unsupported = {
    ...inventory,
    operations: {
      reserve: {
        ...inventory.operations.reserve,
        input: Type.Object({
          labels: Type.Record(Type.String(), Type.Number()),
        }),
      },
    },
  };
  expect(() => serviceContractSource(unsupported)).toThrow(
    "reserve.input.labels: unsupported service schema",
  );
});
async function compileTimeProof(
  ctx: OperationContext<typeof orders, "confirm">,
) {
  const result = await ctx.serviceAttempt("reserve", {
    referenceId: "id",
    lines: [{ productId: "id", quantity: 1 }],
  });
  if (!result.ok) {
    const message: string = result.error.message;
    // @ts-expect-error Provider error fields are inferred from the generated schema.
    result.error.unknown;
    return message;
  }
  const state: "reserved" = result.value.state;
  await ctx.service("reserve", {
    referenceId: "id",
    // @ts-expect-error Public service inputs remain typed across package boundaries.
    lines: [{ productId: "id", quantity: "one" }],
  });
  // @ts-expect-error Private provider operations are not exported as services.
  await ctx.serviceAttempt("create-product", {});
  return state;
}
void compileTimeProof;
