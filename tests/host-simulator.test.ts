import { it, expect } from "vitest";
import {
  createModuleSimulator,
  defineSimulationModule,
} from "@suite/module-sdk/simulator";
import module from "./fixtures/host-capabilities/module";

it("infers and validates simulated capability results while rechecking permission, connectivity and release identity", async () => {
  const fixture = defineSimulationModule(module, {
    hostResults: {
      export: { status: "cancelled" },
      notify: { requested: true },
    },
  });
  const simulator = createModuleSimulator(module, fixture);
  const input = { filename: "test.txt", content: "Private export content" };
  expect(await simulator.host.call("export", input)).toEqual({
    status: "cancelled",
  });
  simulator.setHostResult("export", { status: "saved" });
  expect(await simulator.host.call("export", input)).toEqual({
    status: "saved",
  });
  simulator.setHostResult("export", undefined);
  expect(await simulator.host.call("export", input)).toEqual({
    status: "offered",
  });
  expect(() =>
    simulator.setHostResult("export", { status: "invalid" } as never),
  ).toThrow();
  expect(await simulator.host.call("export", input)).toEqual({
    status: "offered",
  });
  simulator.setPermissions(
    module.permissions.filter((p) => p !== "custom-notes.export"),
  );
  await expect(simulator.host.call("export", input)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  simulator.setPermissions([...module.permissions]);
  simulator.setOnline(false);
  await expect(simulator.host.call("export", input)).rejects.toMatchObject({
    code: "OFFLINE",
  });
  expect(simulator.snapshot().journal).toHaveLength(0);
  simulator.setOnline(true);
  const call = {
    moduleId: module.id,
    moduleVersion: module.version,
    capability: "export",
    input,
  };
  await expect(
    simulator.sendHost({ ...call, moduleId: "foreign" }),
  ).rejects.toMatchObject({ code: "HOST_SCOPE_MISMATCH" });
  await expect(
    simulator.sendHost({ ...call, moduleVersion: "2.0.0" }),
  ).rejects.toMatchObject({ code: "HOST_SCOPE_MISMATCH" });
  await expect(
    simulator.sendHost({ ...call, capability: "unknown" }),
  ).rejects.toMatchObject({ code: "CAPABILITY_UNDECLARED" });
  expect(JSON.stringify(simulator.snapshot().hostActions)).not.toContain(
    input.content,
  );
  const personal = createModuleSimulator(module, { personal: true });
  await expect(personal.host.call("export", input)).rejects.toMatchObject({
    code: "LOCAL_HOST_UNAVAILABLE",
  });
  if (false) {
    defineSimulationModule(module, {
      // @ts-expect-error Capability result fixtures retain the declared result type.
      hostResults: { export: { requested: true } },
    });
    // @ts-expect-error Only declared aliases have simulated results.
    simulator.setHostResult("unknown", { status: "saved" });
    // @ts-expect-error Notification fixtures cannot return export outcomes.
    simulator.setHostResult("notify", { status: "saved" });
  }
  expect(() =>
    defineSimulationModule(module, {
      hostResults: { export: { requested: true } },
    } as never),
  ).toThrow();
});

it("requires explicit relay outcomes and keeps cloned, bounded simulation evidence without business effects", async () => {
  const simulator = createModuleSimulator(module);
  expect(await simulator.host.call("peers", {})).toEqual({
    enabled: false,
    configured: false,
    peers: [],
  });
  const input = {
    peerId: "peer",
    kind: "pending" as const,
    id: "draft",
    payload: "Private relay content",
  };
  await expect(simulator.host.call("relay", input)).rejects.toMatchObject({
    code: "CAPABILITY_UNAVAILABLE",
  });
  simulator.setHostResult("relay", { relayed: true, authoritative: false });
  expect(await simulator.host.call("relay", input)).toEqual({
    relayed: true,
    authoritative: false,
  });
  const fixture = {
    enabled: true,
    configured: true,
    peers: [{ id: "peer", address: "127.0.0.1", port: 49180, seen: 1 }],
  };
  simulator.setHostResult("peers", fixture);
  fixture.peers[0].id = "changed";
  const result = await simulator.host.call("peers", {});
  expect(result.peers[0].id).toBe("peer");
  result.peers.length = 0;
  expect((await simulator.host.call("peers", {})).peers).toHaveLength(1);
  for (let i = 0; i < 110; i++) await simulator.host.call("peers", {});
  const snapshot = simulator.snapshot();
  expect(snapshot.hostActions).toHaveLength(100);
  expect(snapshot.audits).toHaveLength(0);
  expect(snapshot.events).toHaveLength(0);
  expect(snapshot.journal).toHaveLength(0);
  snapshot.hostActions.length = 0;
  expect(simulator.snapshot().hostActions).toHaveLength(100);
});
