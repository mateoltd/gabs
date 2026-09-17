import { defineModule, serviceReference } from "@suite/module-sdk";
import { expect, it } from "vitest";
import {
  executeLocalTransaction,
  defineLocalModule,
  type LocalRequest,
  type LocalModule,
} from "@suite/module-sdk/local";
import {
  consumer,
  provider,
  consumerImplementation,
  providerImplementation,
} from "./fixtures/local-services";
const request = (input = {}): LocalRequest => ({
  profileId: "profile",
  configuration: {},
  call: {
    moduleId: consumer.id,
    moduleVersion: consumer.version,
    operation: "run",
    action: "operation",
    input,
    key: "stable-request",
  },
  snapshot: { records: {}, receipts: {} },
  serviceParticipants: [
    {
      profileId: "profile",
      module: provider,
      configuration: { prefix: "Configured count" },
      snapshot: { records: {}, receipts: {} },
    },
  ],
  serviceGrants: [
    {
      consumerId: consumer.id,
      consumerVersion: consumer.version,
      providerId: provider.id,
      providerVersion: provider.version,
      service: "add",
    },
  ],
});
const implementations = [consumerImplementation, providerImplementation];
it("serializes parallel provider calls in one transaction, propagates context and persists only the root receipt", async () => {
  const input = request();
  const before = JSON.stringify(input);
  const result = await executeLocalTransaction(
    consumer,
    input,
    implementations,
  );
  expect(result.result).toBe(3);
  expect(result.snapshot.records.notes).toHaveLength(1);
  expect(result.participants![provider.id].records.items).toHaveLength(1);
  expect(result.participants![provider.id].records.items[0].data).toEqual({
    name: "Configured count",
    value: 3,
  });
  expect(result.participants![provider.id].receipts).toEqual({});
  expect(Object.keys(result.snapshot.receipts)).toEqual(["stable-request"]);
  expect(JSON.stringify(input)).toBe(before);
  const retry = await executeLocalTransaction(
    consumer,
    { ...input, snapshot: result.snapshot, serviceGrants: [] },
    implementations,
  );
  expect(retry.result).toBe(3);
  expect(retry.participants).toBeUndefined();
});
it("a caught or detached service rejection poisons the entire transaction, while translated business errors retain the consumer contract", async () => {
  for (const input of [{ fail: true }, { fail: true, detached: true }]) {
    const data = request(input);
    await expect(
      executeLocalTransaction(consumer, data, implementations),
    ).rejects.toMatchObject({
      code: "MODULE_BUSINESS_ERROR",
      detail: { moduleId: provider.id, error: { reason: "blocked" } },
    });
    expect(data.snapshot).toEqual({ records: {}, receipts: {} });
    expect(data.serviceParticipants![0].snapshot).toEqual({
      records: {},
      receipts: {},
    });
  }
  await expect(
    executeLocalTransaction(
      consumer,
      request({ fail: true, translate: true }),
      implementations,
    ),
  ).rejects.toMatchObject({
    code: "MODULE_BUSINESS_ERROR",
    detail: { moduleId: consumer.id, error: { reason: "translated" } },
  });
  const detached = await executeLocalTransaction(
    consumer,
    request({ detached: true }),
    implementations,
  );
  expect(detached.participants![provider.id].records.items[0].data.value).toBe(
    1,
  );
});
it("rejects missing, stale, foreign and undeclared service authority without modifying input snapshots", async () => {
  const inputs = Array.from({ length: 6 }, () => request());
  inputs[0].serviceGrants = [];
  inputs[1].serviceGrants![0].providerVersion = "2.0.0";
  inputs[2].serviceParticipants![0].profileId = "foreign";
  inputs[3].serviceParticipants!.push(
    structuredClone(inputs[3].serviceParticipants![0]),
  );
  inputs[4].serviceGrants![0].service = "undeclared";
  inputs[5].serviceParticipants![0].module = { ...provider, permissions: [] };
  for (const input of inputs) {
    const before = JSON.stringify(input);
    await expect(
      executeLocalTransaction(consumer, input, implementations),
    ).rejects.toMatchObject({ code: "LOCAL_SCOPE_DENIED" });
    expect(JSON.stringify(input)).toBe(before);
  }
});
it("validates the exact provider operation contract and rejects recursive service execution", async () => {
  const changed = request();
  changed.serviceParticipants![0].module = {
    ...provider,
    operations: {
      ...provider.operations,
      add: { ...provider.operations.add, public: false },
    },
  };
  await expect(
    executeLocalTransaction(consumer, changed, implementations),
  ).rejects.toMatchObject({ code: "LOCAL_SCOPE_DENIED" });
  const recursive = {
    ...provider,
    dependencies: { [consumer.id]: "^1" },
    services: {
      back: {
        moduleId: consumer.id,
        version: consumer.version,
        operation: "run",
        contract: consumer.operations.run,
      },
    },
  };
  const participant: LocalModule = {
    module: recursive,
    execute: (_name, _input, ctx) => ctx.service!("back", {}),
  };
  const input = request();
  input.serviceParticipants![0].module = recursive;
  input.serviceGrants!.push({
    consumerId: provider.id,
    consumerVersion: provider.version,
    providerId: consumer.id,
    providerVersion: consumer.version,
    service: "back",
  });
  await expect(
    executeLocalTransaction(consumer, input, [
      consumerImplementation,
      participant,
    ]),
  ).rejects.toMatchObject({ code: "LOCAL_SCOPE_DENIED" });
});

it("granted reference lookups see provider records created earlier in the shared transaction", async () => {
  const input = request({ link: true });
  input.referenceProviders = [
    {
      profileId: "profile",
      module: provider,
      resources: ["items"],
      records: { items: [] },
    },
  ];
  const result = await executeLocalTransaction(
    consumer,
    input,
    implementations,
  );
  expect(result.snapshot.records.notes[1].data.target).toBe(
    result.participants![provider.id].records.items[0].id,
  );
  const mismatched = request({ link: true });
  mismatched.referenceProviders = [
    {
      profileId: "profile",
      module: { ...provider, version: "1.1.0" },
      resources: ["items"],
      records: { items: [] },
    },
  ];
  await expect(
    executeLocalTransaction(consumer, mismatched, implementations),
  ).rejects.toMatchObject({ code: "LOCAL_CONTRACT_MISMATCH" });
});

it("propagates a granted service chain and commits every participant, while a missing downstream grant aborts it", async () => {
  const leaf = defineModule({
    ...provider,
    id: "local-leaf",
    name: "Leaf",
    permissions: provider.permissions.map((p) =>
      p.replace("local-provider.", "local-leaf."),
    ),
    operations: {
      add: { ...provider.operations.add, permission: "local-leaf.add" },
      online: {
        ...provider.operations.online,
        permission: "local-leaf.online",
      },
    },
  });
  const middle = defineModule({
    ...provider,
    dependencies: { [leaf.id]: "^1" },
    services: { leaf: serviceReference(leaf, "add") },
  });
  const leafImplementation = defineLocalModule(leaf)({
    async add(ctx, input) {
      const row = await ctx
        .resource("items")
        .create({ name: ctx.caller!.moduleId, value: input.amount });
      return {
        id: row.id,
        total: input.amount,
        profile: ctx.profileId,
        request: ctx.requestId,
        caller: ctx.caller!.moduleId,
      };
    },
  });
  const middleImplementation = defineLocalModule(middle)({
    async add(ctx, input) {
      const result = await ctx.service("leaf", input);
      await ctx
        .resource("items")
        .create({ name: "Delegated", value: result.total });
      return { ...result, caller: ctx.caller!.moduleId };
    },
  });
  const input = request();
  input.serviceParticipants![0].module = middle;
  input.serviceParticipants!.push({
    profileId: "profile",
    module: leaf,
    configuration: {},
    snapshot: { records: {}, receipts: {} },
  });
  const modules = [
    consumerImplementation,
    middleImplementation,
    leafImplementation,
  ];
  await expect(
    executeLocalTransaction(consumer, input, modules),
  ).rejects.toMatchObject({ code: "LOCAL_SCOPE_DENIED" });
  input.serviceGrants!.push({
    consumerId: middle.id,
    consumerVersion: middle.version,
    providerId: leaf.id,
    providerVersion: leaf.version,
    service: "leaf",
  });
  const result = await executeLocalTransaction(consumer, input, modules);
  expect(
    result.participants![leaf.id].records.items.map((row) => row.data),
  ).toEqual([
    { name: middle.id, value: 1 },
    { name: middle.id, value: 2 },
  ]);
  expect(result.participants![middle.id].records.items).toHaveLength(2);
  expect(result.snapshot.records.notes).toHaveLength(1);
});
