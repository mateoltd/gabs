import { expect, it } from "vitest";
import {
  createModuleSimulator,
  defineSimulationModule,
  grantSimulationServices,
} from "@suite/module-sdk/simulator";
import { defineLocalModule } from "@suite/module-sdk/local";
import {
  defineModule,
  operation,
  serviceReference,
  Type,
} from "@suite/module-sdk";
import local, { module } from "../fixtures/local-device-requests";

const create = () => createModuleSimulator(module, { personal: true, local });
it("runs actual standalone handlers offline with explicit consent, atomic records and stable receipt replay", async () => {
  const sim = create();
  sim.setOnline(false);
  await expect(
    sim.localClient.call("capture", { text: "Denied" }),
  ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  expect(sim.snapshot().records.notes).toEqual([]);
  sim.setDeviceAccess("export", true);
  const id = await sim.localClient.call(
    "capture",
    { text: "Saved" },
    "stable-device-request",
  );
  expect(sim.snapshot().local!.deviceRequests).toMatchObject([
    { id, state: "pending" },
  ]);
  expect(sim.snapshot().records.notes).toHaveLength(1);
  sim.setDeviceAccess("export", false);
  expect(
    await sim.localClient.call(
      "capture",
      { text: "Saved" },
      "stable-device-request",
    ),
  ).toBe(id);
  await expect(sim.processDeviceRequest(id)).rejects.toMatchObject({
    code: "CAPABILITY_DENIED",
  });
  sim.setDeviceAccess("export", true);
  const retry = sim.retryDeviceRequest(id);
  expect(sim.retryDeviceRequest(id)).toBe(retry);
  sim.setHostResult("export", { status: "saved" });
  expect(await sim.processDeviceRequest(retry)).toEqual({ status: "saved" });
  expect(await sim.processDeviceRequest(retry)).toEqual({ status: "saved" });
  sim.dismissDeviceRequest(id);
  sim.dismissDeviceRequest(retry);
  expect(sim.snapshot().local!.deviceRequests).toHaveLength(0);
  expect((await sim.localClient.resource("notes").list()).items).toHaveLength(
    1,
  );
  expect(sim.snapshot().journal).toEqual([]);
});
it("models interrupted outcomes and requires explicit review without repeating business writes", async () => {
  const sim = create();
  sim.setDeviceAccess("export", true);
  const id = await sim.localClient.call("capture", { text: "Interrupted" });
  await sim.processDeviceRequest(id, { interrupt: true });
  expect(() => sim.dismissDeviceRequest(id)).toThrow(/Recover/);
  sim.lockProfile();
  await expect(sim.localClient.resource("notes").list()).rejects.toMatchObject({
    code: "PROFILE_LOCKED",
  });
  sim.unlockProfile();
  expect(sim.snapshot().local!.deviceRequests[0].state).toBe("uncertain");
  expect(() => sim.retryDeviceRequest(id)).toThrow(/Review/);
  const retry = sim.retryDeviceRequest(id, { confirmUncertain: true });
  await sim.processDeviceRequest(retry);
  expect(sim.snapshot().records.notes).toHaveLength(1);
  expect(sim.snapshot().local!.deviceRequests).toHaveLength(2);
});
it("rolls back business failure, journal overflow and consent changes during a suspended handler", async () => {
  const sim = create();
  sim.setDeviceAccess("export", true);
  await expect(
    sim.localClient.call("capture", { text: "Rejected", reject: true }),
  ).rejects.toMatchObject({ code: "MODULE_BUSINESS_ERROR" });
  expect(sim.snapshot().local!.deviceRequests).toEqual([]);
  for (let i = 0; i < 16; i++)
    await sim.localClient.call("capture", { text: `Batch ${i}`, count: 16 });
  await expect(
    sim.localClient.call("capture", { text: "Overflow" }),
  ).rejects.toThrow(/Clear simulated/);
  expect(sim.snapshot().records.notes).toHaveLength(16);
  expect(sim.snapshot().local!.deviceRequests).toHaveLength(256);
  let enter!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = createModuleSimulator(module, {
    personal: true,
    deviceAccess: ["export"],
    local: defineLocalModule(module)({
      async capture(ctx, input) {
        await ctx.resource("notes").create({ name: input.text });
        const id = await ctx.device.request("export", {
          filename: "held.txt",
          content: input.text,
        });
        enter();
        await wait;
        return id;
      },
    }),
  });
  const pending = held.localClient.call("capture", { text: "Must roll back" });
  const rejected = expect(pending).rejects.toThrow(/consent changed/);
  await started;
  held.setDeviceAccess("export", false);
  release();
  await rejected;
  expect(held.snapshot().records.notes).toEqual([]);
  expect(held.snapshot().local!.deviceRequests).toEqual([]);
});
it("uses the provider's own device consent within a granted atomic standalone service", async () => {
  const provider = defineModule({
    ...module,
    operations: { capture: { ...module.operations.capture, public: true } },
  });
  const providerLocal = defineLocalModule(provider)({
    async capture(ctx, input) {
      await ctx.resource("notes").create({ name: input.text });
      return ctx.device.request("export", {
        filename: "service.txt",
        content: input.text,
      });
    },
  });
  const consumer = defineModule({
    ...module,
    id: "device-consumer",
    name: "Device consumer",
    resources: {},
    capabilities: {},
    permissions: ["device-consumer.run"],
    dependencies: { [provider.id]: "^1.0.0" },
    services: { capture: serviceReference(provider, "capture") },
    operations: {
      run: operation({
        title: "Run",
        policy: "local",
        permission: "device-consumer.run",
        input: Type.Object({ text: Type.String() }),
        output: Type.String(),
      }),
    },
  });
  const simulation = createModuleSimulator(consumer, {
    personal: true,
    local: defineLocalModule(consumer)({
      run: (ctx, input) => ctx.service("capture", input),
    }),
    providers: [defineSimulationModule(provider, { local: providerLocal })],
    grants: grantSimulationServices(consumer, "capture"),
  });
  await expect(
    simulation.localClient.call("run", { text: "Denied provider" }),
  ).rejects.toThrow();
  expect(simulation.inspect(provider).records.notes).toEqual([]);
  simulation.setModuleDeviceAccess(provider.id, "export", true);
  const id = await simulation.localClient.call("run", {
    text: "Provider write",
  });
  expect(simulation.snapshot().local!.deviceRequests[0].call.moduleId).toBe(
    provider.id,
  );
  expect(await simulation.processDeviceRequest(id)).toEqual({
    status: "offered",
  });
  expect(simulation.inspect(provider).records.notes).toHaveLength(1);
});
it("rejects invalid fixture contracts and preserves inferred local and capability interfaces", () => {
  expect(() =>
    defineSimulationModule(module, { deviceAccess: ["unknown"] } as never),
  ).toThrow(/Undeclared/);
  expect(() =>
    defineSimulationModule(module, {
      local: { ...local, module: { ...module, version: "2.0.0" } },
    }),
  ).toThrow(/must match/);
  const sim = create();
  if (false) {
    // @ts-expect-error invalid capability aliases must not reach development scenarios
    sim.setDeviceAccess("unknown", true);
    // @ts-expect-error capability-specific result types are inferred
    sim.setHostResult("export", { requested: true });
    // @ts-expect-error standalone operation input is inferred
    void sim.localClient.call("capture", { text: 123 });
    // @ts-expect-error resources must be declared standalone
    sim.localClient.resource("unknown");
  }
});
