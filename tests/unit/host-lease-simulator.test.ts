import { expect, it } from "vitest";
import { defineModule } from "@suite/module-sdk";
import {
  createModuleSimulator,
  defineSimulationModule,
} from "@suite/module-sdk/simulator";
import base from "../fixtures/host-capabilities/module";
const module = defineModule({
  ...base,
  capabilities: {
    ...base.capabilities,
    export: { ...base.capabilities.export, offline: "lease" },
  },
});
const input = { filename: "notes.txt", content: "Private content" };
it("infers only lease-enabled fixtures and rejects forged JavaScript fixtures", () => {
  defineSimulationModule(module, {
    hostLeases: { export: { remainingMs: 1000 } },
  });
  for (const hostLeases of [
    { unknown: { remainingMs: 1000 } },
    { notify: { remainingMs: 1000 } },
    { export: { remainingMs: -1 } },
    { export: { remainingMs: 86400001 } },
    { export: { remainingMs: Infinity } },
  ])
    expect(() =>
      defineSimulationModule(module, { hostLeases } as never),
    ).toThrow();
  expect(() =>
    createModuleSimulator(module, {
      personal: true,
      hostLeases: { export: { remainingMs: 1 } },
    }),
  ).toThrow(/company/);
  if (false) {
    defineSimulationModule(module, {
      // @ts-expect-error Online-only aliases cannot have a lease fixture.
      hostLeases: { notify: { remainingMs: 1000 } },
    });
    defineSimulationModule(module, {
      // @ts-expect-error Unknown aliases cannot have a lease fixture.
      hostLeases: { other: { remainingMs: 1000 } },
    });
    const s = createModuleSimulator(module);
    // @ts-expect-error Only declared lease aliases may be renewed.
    s.grantHostLease("notify");
    // @ts-expect-error Prepared calls retain inferred input types.
    s.prepareHost("export", { title: "Wrong" });
    const result = s.prepareHost("export", input).complete();
    const typed: Promise<{ status: "offered" | "saved" | "cancelled" }> =
      result;
    void typed;
  }
});
it("simulates missing, valid, expired, revoked and renewed leases without business or device effects", async () => {
  const s = createModuleSimulator(module);
  s.setOnline(false);
  await expect(s.host.call("export", input)).rejects.toMatchObject({
    code: "LEASE_MISSING",
  });
  expect(() => s.grantHostLease("export")).toThrow(/Reconnect/);
  s.setOnline(true);
  s.grantHostLease("export", 60000);
  s.setOnline(false);
  await expect(s.host.call("export", input)).resolves.toEqual({
    status: "offered",
  });
  await expect(
    s.host.call("notify", { title: "Hello", message: "World" }),
  ).rejects.toMatchObject({ code: "OFFLINE" });
  expect(s.snapshot().hostActions[1].authority).toBe("lease");
  s.advanceHostTime(60000);
  await expect(s.host.call("export", input)).rejects.toMatchObject({
    code: "LEASE_EXPIRED",
  });
  expect(s.snapshot().hostLeases.export.state).toBe("expired");
  expect(() => s.advanceHostTime(-1)).toThrow();
  s.setOnline(true);
  await expect(s.host.call("export", input)).resolves.toEqual({
    status: "offered",
  });
  expect(s.snapshot().hostLeases.export.state).toBe("expired");
  s.grantHostLease("export");
  s.revokeHostLease("export");
  s.setOnline(false);
  await expect(s.host.call("export", input)).rejects.toMatchObject({
    code: "LEASE_REVOKED",
  });
  const snapshot = s.snapshot();
  expect(snapshot.journal).toEqual([]);
  expect(snapshot.audits).toEqual([]);
  expect(snapshot.events).toEqual([]);
  expect(JSON.stringify(snapshot.hostActions)).not.toContain(input.content);
  snapshot.hostLeases.export.state = "valid";
  expect(s.snapshot().hostLeases.export.state).toBe("revoked");
});
it("rechecks held actions against expiry, permission changes and replacement grants", async () => {
  const s = createModuleSimulator(module, {
    hostLeases: { export: { remainingMs: 1000 } },
  });
  s.setOnline(false);
  s.setPermissions([...module.permissions].reverse());
  expect(s.snapshot().hostLeases.export.state).toBe("valid");
  const expired = s.prepareHost("export", input);
  s.advanceHostTime(1000);
  await expect(expired.complete()).rejects.toMatchObject({
    code: "LEASE_EXPIRED",
  });
  await expect(expired.complete()).rejects.toMatchObject({
    code: "HOST_ACTION_FINISHED",
  });
  s.setOnline(true);
  s.grantHostLease("export");
  s.setOnline(false);
  const revoked = s.prepareHost("export", input);
  s.setPermissions(
    module.permissions.filter((p) => p !== "custom-notes.export"),
  );
  await expect(revoked.complete()).rejects.toMatchObject({ code: "FORBIDDEN" });
  s.setPermissions(module.permissions);
  await expect(s.host.call("export", input)).rejects.toMatchObject({
    code: "LEASE_REVOKED",
  });
  s.setOnline(true);
  s.grantHostLease("export");
  s.setOnline(false);
  const replaced = s.prepareHost("export", input);
  s.setOnline(true);
  s.grantHostLease("export");
  s.setOnline(false);
  await expect(replaced.complete()).rejects.toMatchObject({
    code: "LEASE_CHANGED",
  });
  const accepted = s.prepareHost("export", input);
  await expect(accepted.complete()).resolves.toEqual({ status: "offered" });
  expect(
    s.snapshot().hostActions.filter((a) => a.state === "simulated"),
  ).toHaveLength(1);
});
