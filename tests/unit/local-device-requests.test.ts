import { expect, it } from "vitest";
import {
  defineLocalModule,
  executeLocalTransaction,
  type LocalRequest,
  type LocalContext,
} from "@suite/module-sdk/local";
import { validateLocalArtifact } from "@suite/module-sdk/local-artifact";
import implementation, { module } from "../fixtures/local-device-requests";
import {
  defineModule,
  operation,
  serviceReference,
  Type,
} from "@suite/module-sdk";

const request = (input = { text: "Saved note" }): LocalRequest => ({
  profileId: "profile",
  configuration: {},
  call: {
    moduleId: module.id,
    moduleVersion: module.version,
    action: "operation",
    operation: "capture",
    key: "stable-request",
    input,
  },
  snapshot: { records: {}, receipts: {} },
  deviceGrants: [
    {
      id: "consent",
      moduleId: module.id,
      moduleVersion: module.version,
      capability: "export",
      kind: "files.export",
      permission: "device-notes.export",
      releaseDigest: "verified-release",
    },
  ],
});
it("returns device requests with atomic records and a receipt without executing a device effect", async () => {
  const input = request();
  const result = await executeLocalTransaction(module, input, [implementation]);
  expect(result.snapshot.records.notes[0].data.name).toBe("Saved note");
  expect(result.deviceRequests).toEqual([
    {
      id: result.result,
      grantId: "consent",
      call: {
        moduleId: module.id,
        moduleVersion: module.version,
        capability: "export",
        input: { filename: "notes.txt", content: "Saved note" },
      },
    },
  ]);
  expect(input.snapshot).toEqual({ records: {}, receipts: {} });
  const replay = await executeLocalTransaction(
    module,
    { ...input, snapshot: result.snapshot, deviceGrants: [] },
    [implementation],
  );
  expect(replay.result).toBe(result.result);
  expect(replay.deviceRequests).toBeUndefined();
});
it("rejects missing or mismatched consent and rolls back records when a later business rule rejects", async () => {
  for (const grants of [
    [],
    [{ ...request().deviceGrants![0], permission: "device-notes.notify" }],
    [{ ...request().deviceGrants![0], moduleVersion: "2.0.0" }],
  ])
    await expect(
      executeLocalTransaction(module, { ...request(), deviceGrants: grants }, [
        implementation,
      ]),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  const input = request();
  input.call.input = { text: "Rejected", reject: true };
  await expect(
    executeLocalTransaction(module, input, [implementation]),
  ).rejects.toMatchObject({ code: "MODULE_BUSINESS_ERROR" });
  expect(input.snapshot).toEqual({ records: {}, receipts: {} });
});
it("bounds requests and invalid caught or detached requests poison the transaction", async () => {
  const input = request();
  input.call.input = { text: "Too many", count: 17 };
  await expect(
    executeLocalTransaction(module, input, [implementation]),
  ).rejects.toMatchObject({ code: "LOCAL_DEVICE_LIMIT" });
  for (const detached of [false, true]) {
    const bad = defineLocalModule(module)({
      async capture(ctx) {
        await ctx.resource("notes").create({ name: "Must roll back" });
        const task = ctx.device.request("export", {
          filename: "../escape.txt",
          content: "Invalid",
        });
        if (detached) void task.catch(() => {});
        else await task.catch(() => {});
        return "ignored";
      },
    });
    await expect(
      executeLocalTransaction(module, request(), [bad]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  }
});
it("supports retained v1 bundles and rejects unsupported local runtime formats", () => {
  for (const format of ["suite-local-v1", "suite-local-v2"])
    expect(
      validateLocalArtifact({
        ...module,
        local: { format, javascript: "export default {};" },
      })?.format,
    ).toBe(format);
  expect(() =>
    validateLocalArtifact({
      ...module,
      local: { format: "suite-local-v3", javascript: "export default {};" },
    }),
  ).toThrow(/Update the host/);
});

function inferred(ctx: LocalContext<typeof module, "capture">) {
  const id: Promise<string> = ctx.device.request("export", {
    filename: "typed.txt",
    content: "Typed",
  });
  // @ts-expect-error Module capability aliases are inferred.
  ctx.device.request("missing", {});
  // @ts-expect-error Export inputs require content.
  ctx.device.request("export", { filename: "typed.txt" });
  // @ts-expect-error Notification inputs cannot be used for an export.
  ctx.device.request("export", { title: "Notice", message: "Text" });
  return id;
}
void inferred;

it("snapshots request inputs immediately and handles unserializable data as a transaction failure", async () => {
  const snapshot = defineLocalModule(module)({
    async capture(ctx) {
      const input = { filename: "original.txt", content: "Original" };
      const pending = ctx.device.request("export", input);
      input.content = "Changed";
      return pending;
    },
  });
  const result = await executeLocalTransaction(module, request(), [snapshot]);
  expect(result.deviceRequests![0].call.input).toEqual({
    filename: "original.txt",
    content: "Original",
  });
  const invalid = defineLocalModule(module)({
    async capture(ctx) {
      await ctx.resource("notes").create({ name: "Must roll back" });
      await ctx.device
        .request("export", {
          filename: "bad.txt",
          content: (() => {}) as unknown as string,
        })
        .catch(() => {});
      return "caught";
    },
  });
  await expect(
    executeLocalTransaction(module, request(), [invalid]),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

it("public service device requests require the provider's consent and roll back with the caller", async () => {
  const provider = defineModule({
    ...module,
    operations: { capture: { ...module.operations.capture, public: true } },
  });
  const consumer = defineModule({
    id: "device-consumer",
    name: "Device consumer",
    version: "1.0.0",
    host: "^1",
    backend: "^1",
    publisher: "suite",
    description: "Service device acceptance",
    configuration: Type.Object({}),
    dependencies: { [provider.id]: "^1" },
    permissions: ["device-consumer.run"],
    resources: {},
    services: { capture: serviceReference(provider, "capture") },
    operations: {
      run: operation({
        title: "Capture",
        policy: "local",
        permission: "device-consumer.run",
        input: Type.Object({ reject: Type.Optional(Type.Boolean()) }),
        output: Type.String(),
      }),
    },
  });
  const implementations = [
    defineLocalModule(provider)({
      async capture(ctx, input) {
        await ctx.resource("notes").create({ name: input.text });
        return ctx.device.request("export", {
          filename: "provider.txt",
          content: input.text,
        });
      },
    }),
    defineLocalModule(consumer)({
      async run(ctx, input) {
        const id = await ctx.service("capture", { text: "Provider record" });
        if (input.reject) throw Error("Caller rejected after device request");
        return id;
      },
    }),
  ];
  const input: LocalRequest = {
    ...request(),
    call: {
      moduleId: consumer.id,
      moduleVersion: consumer.version,
      action: "operation",
      operation: "run",
      key: "service-device",
      input: {},
    },
    serviceParticipants: [
      {
        module: provider,
        profileId: "profile",
        configuration: {},
        snapshot: { records: {}, receipts: {} },
      },
    ],
    serviceGrants: [
      {
        consumerId: consumer.id,
        consumerVersion: consumer.version,
        providerId: provider.id,
        providerVersion: provider.version,
        service: "capture",
      },
    ],
  };
  const result = await executeLocalTransaction(
    consumer,
    input,
    implementations,
  );
  expect(result.deviceRequests?.[0].call.moduleId).toBe(provider.id);
  expect(result.participants![provider.id].records.notes[0].data.name).toBe(
    "Provider record",
  );
  await expect(
    executeLocalTransaction(
      consumer,
      {
        ...input,
        deviceGrants: [{ ...input.deviceGrants![0], moduleId: consumer.id }],
      },
      implementations,
    ),
  ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  await expect(
    executeLocalTransaction(
      consumer,
      { ...input, call: { ...input.call, input: { reject: true } } },
      implementations,
    ),
  ).rejects.toThrow("Caller rejected");
  expect(input.serviceParticipants![0].snapshot).toEqual({
    records: {},
    receipts: {},
  });
});
