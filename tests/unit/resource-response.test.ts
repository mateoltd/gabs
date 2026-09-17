import { expect, it } from "vitest";
import {
  createModuleClient,
  resourceRecordSchema,
  resourcePageSchema,
  assertSchema,
  ResourceResponseError,
  isResourceResponseError,
  type Static,
  type ModuleCall,
} from "@suite/module-sdk";
import module from "../fixtures/resource-query/module";
const data = { name: "Valid", amount: 2, approved: true };
const row = {
  id: "record",
  data,
  version: 1,
  archived: false,
  updatedAt: "2026-09-17T00:00:00.000Z",
};
it("derives validated resource records and pages from the declared data schema", async () => {
  const schema = resourceRecordSchema(module.resources.records.schema);
  const typed: Static<typeof schema> = row;
  if (false) {
    // @ts-expect-error Response data fields retain the resource schema.
    typed.data.amount = "two";
    // @ts-expect-error Record metadata remains typed.
    typed.archived = 1;
  }
  assertSchema(schema, row);
  assertSchema(resourcePageSchema(module.resources.records.schema), {
    items: [row],
    nextCursor: null,
  });
  const extra = { ...row, futureMetadata: "compatible" };
  const client = createModuleClient(module, async (call) =>
    call.action === "list"
      ? { items: [extra], nextCursor: "cursor", futureMetadata: true }
      : extra,
  ).resource("records");
  expect(await client.get("record")).toBe(extra);
  expect((await client.list()).items[0]).toBe(extra);
});
it("rejects malformed resource data and metadata on every resource response path", async () => {
  const malformed: unknown[] = [
    null,
    {},
    { ...row, id: "" },
    { ...row, version: 0 },
    { ...row, version: 1.2 },
    { ...row, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...row, archived: "false" },
    { ...row, updatedAt: null },
    { ...row, updatedAt: "" },
    { ...row, data: { ...data, amount: "two" } },
    { ...row, data: { ...data, extra: true } },
    { ...row, data: { name: "missing fields" } },
  ];
  for (const value of malformed) {
    const sent: ModuleCall[] = [];
    const client = createModuleClient(module, async (call) => {
      sent.push(call);
      return call.action === "list"
        ? { items: [row, value], nextCursor: null }
        : value;
    }).resource("records");
    for (const [action, run] of [
      ["get", () => client.get("record")],
      ["list", () => client.list()],
      ["create", () => client.create(data, "create-key")],
      ["update", () => client.update(row.id, data, row, "update-key")],
      ["archive", () => client.archive(row.id, row.version, "archive-key")],
    ] as const) {
      const before = sent.length;
      await expect(run()).rejects.toMatchObject({
        code: "INVALID_RESOURCE_RESPONSE",
        moduleId: module.id,
        resource: "records",
        action,
        idempotencyKey:
          action === "get" || action === "list" ? undefined : `${action}-key`,
      });
      expect(sent).toHaveLength(before + 1);
    }
  }
});
it("rejects malformed pages and provisional results instead of presenting typed success", async () => {
  for (const result of [
    { items: null, nextCursor: null },
    { items: [row], nextCursor: 3 },
    { items: [row], nextCursor: "" },
    { items: [] },
    { state: "pending", id: "journal" },
  ]) {
    const client = createModuleClient(module, async () => result).resource(
      "records",
    );
    await expect(client.list()).rejects.toBeInstanceOf(ResourceResponseError);
  }
  const sent: ModuleCall[] = [];
  const client = createModuleClient(module, async (call) => {
    sent.push(call);
    return { state: "pending", id: "journal" };
  }).resource("records");
  let failure: unknown;
  try {
    await client.create(data);
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({
    code: "INVALID_RESOURCE_RESPONSE",
    idempotencyKey: sent[0].key,
  });
  expect(isResourceResponseError(failure)).toBe(true);
  const transported = JSON.parse(
    JSON.stringify({
      ...(failure as object),
      message: (failure as Error).message,
    }),
  );
  expect(isResourceResponseError(transported)).toBe(true);
  expect(isResourceResponseError({ ...transported, idempotencyKey: 3 })).toBe(
    false,
  );
  expect(isResourceResponseError({ ...transported, code: "OTHER_ERROR" })).toBe(
    false,
  );
  expect(sent[0].key).toBeTruthy();
  expect((failure as Error).message).toContain("may have completed");
  expect(sent).toHaveLength(1);
});
it("preserves transport errors and lets cancellation win over malformed late responses", async () => {
  const original = Object.assign(new Error("Connection lost"), {
    code: "CONNECTION_LOST",
  });
  const client = createModuleClient(module, async () => {
    throw original;
  }).resource("records");
  await expect(client.create(data, "same-key")).rejects.toBe(original);
  const controller = new AbortController();
  const cancelled = createModuleClient(module, async () => {
    controller.abort();
    return null;
  }).resource("records");
  await expect(
    cancelled.get("record", { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("validates standalone adapter results without changing local receipts or record versions", async () => {
  const { executeLocalCall } = await import("@suite/module-sdk/local");
  let snapshot: import("@suite/module-sdk/local").LocalSnapshot = {
    records: {},
    receipts: {},
  };
  const client = createModuleClient(module, async (call) => {
    const outcome = await executeLocalCall(module, {
      profileId: "validation-proof",
      configuration: {},
      snapshot,
      call,
    });
    snapshot = outcome.snapshot;
    return outcome.result;
  }).resource("records");
  const created = await client.create(data, "create-key");
  expect(await client.create(data, "create-key")).toEqual(created);
  expect((await client.list()).items).toEqual([created]);
  const updated = await client.update(
    created.id,
    { ...data, amount: 3 },
    created,
    "update-key",
  );
  expect(updated.version).toBe(2);
  expect(await client.get(created.id)).toEqual(updated);
  const archived = await client.archive(
    updated.id,
    updated.version,
    "archive-key",
  );
  expect(archived).toMatchObject({
    archived: true,
    version: 3,
    data: { amount: 3 },
  });
  expect((await client.list()).items).toEqual([]);
  expect(Object.keys(snapshot.receipts)).toHaveLength(3);
});
