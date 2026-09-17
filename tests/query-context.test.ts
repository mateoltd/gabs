import { expect, it } from "vitest";
import { type OperationContext } from "@suite/module-sdk";
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import module from "./fixtures/resource-query/module";
import server from "./fixtures/resource-query/module-server";

// The read-only projection shares the complete inferred query contract with module clients.
function contracts(ctx: OperationContext<typeof module, "approved">) {
  if (false) {
    const records = ctx.resource("records");
    void ctx.resource("records").list(
      {
        where: { approved: true },
        ranges: { amount: { gte: 0 } },
        orderBy: [{ field: "amount", direction: "desc" }],
      },
      { signal: new AbortController().signal },
    );
    // @ts-expect-error Query contexts cannot create resource records.
    ctx.resource("records").create({ name: "bad", amount: 1, approved: true });
    // @ts-expect-error Query contexts cannot archive records.
    ctx.resource("records").archive("id", 1);
    // @ts-expect-error Only declared resources are available.
    ctx.resource("missing");
    // @ts-expect-error Equality operands retain their schema types.
    ctx.resource("records").list({ where: { amount: "one" } });
    // @ts-expect-error Boolean fields cannot use range operators.
    ctx.resource("records").list({ ranges: { approved: { gte: true } } });
    // @ts-expect-error Unknown sort fields are rejected during authoring.
    records.list({ orderBy: [{ field: "missing", direction: "asc" }] });
    // @ts-expect-error Sort directions are a closed contract.
    records.list({ orderBy: [{ field: "amount", direction: "up" }] });
  }
}
void contracts;
it("composes filtered, ranged and ordered resource pages in read-only module queries", async () => {
  const simulator = createModuleSimulator(module, { server });
  const client = simulator.client;
  for (let i = 0; i < 7; i++)
    await client
      .resource("records")
      .create({ name: `Record ${i + 1}`, amount: i, approved: i % 2 === 0 });
  const first = await client.call("approved", { minimum: 2 });
  expect(first.names).toEqual(["Record 7", "Record 5"]);
  expect(first.nextCursor).toBeTruthy();
  const second = await client.call("approved", {
    minimum: 2,
    cursor: first.nextCursor!,
  });
  expect(second).toEqual({ names: ["Record 3"], nextCursor: null });
  await expect(
    client.call("approved", { minimum: 3, cursor: first.nextCursor! }),
  ).rejects.toThrow();
  simulator.setPermissions(
    module.permissions.filter(
      (permission) => permission !== "query-proof.records.read",
    ),
  );
  await expect(client.call("approved", { minimum: 2 })).rejects.toThrow(
    /permission/i,
  );
});
