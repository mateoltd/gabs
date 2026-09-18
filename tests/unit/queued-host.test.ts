import { expect, it, vi } from "vitest";
import { sendModuleCall } from "../../packages/client/src/modules/transport";
import type { SuiteClient } from "../../packages/client/src/api";
import { flushJournal, type JournalEntry } from "@suite/module-sdk/sync";
import { describeViewHost, assertViewHost } from "@suite/module-sdk/host-ui";

it("routes commands and queries to their operation endpoints with exact version, key and cancellation", async () => {
  const request = vi.fn(async (..._args: unknown[]) => ({}));
  const client = { request } as unknown as SuiteClient;
  const scope = { userId: "user", workspaceId: "workspace" };
  const call = {
    moduleId: "notes",
    moduleVersion: "1.2.0",
    action: "operation" as const,
    operation: "capture",
    key: "Opaque retry:1",
    input: { name: "Saved" },
  };
  const options = { signal: new AbortController().signal };
  await sendModuleCall(client, scope, call, options);
  expect(request).toHaveBeenLastCalledWith(
    {
      operation: "moduleOperation",
      params: {
        workspaceId: "workspace",
        moduleId: "notes",
        operationName: "capture",
      },
      body: call.input,
      moduleVersion: "1.2.0",
      idempotencyKey: "Opaque retry:1",
    },
    options,
  );
  await sendModuleCall(client, scope, { ...call, kind: "query" }, options);
  expect(request.mock.calls.at(-1)).toEqual([
    expect.objectContaining({ operation: "moduleQuery" }),
    options,
  ]);
});

it("leaves unauthorized commands unsubmitted without blocking independent eligible work or losing prerequisites", async () => {
  const entries: JournalEntry[] = ["denied", "child", "independent"].map(
    (id) => ({
      id,
      userId: "user",
      workspaceId: "workspace",
      call: {
        moduleId: "notes",
        action: "operation",
        operation: id,
        input: {},
      },
      dependencies: id === "child" ? ["denied"] : [],
      state: "pending",
      delivery: "unsubmitted",
      createdAt: 1,
      attempts: 0,
    }),
  );
  const store = {
    list: async () => structuredClone(entries),
    put: async (entry: JournalEntry) => {
      entries[entries.findIndex((e) => e.id === entry.id)] = entry;
    },
  };
  const send = vi.fn(async (..._args: unknown[]) => ({}));
  await flushJournal(
    store,
    send,
    () => true,
    (call) => call.operation !== "denied",
  );
  expect(entries.map((e) => [e.state, e.attempts])).toEqual([
    ["pending", 0],
    ["pending", 0],
    ["accepted", 1],
  ]);
  expect(entries[0].delivery).toBe("unsubmitted");
  await flushJournal(store, send, () => true);
  expect(entries.every((e) => e.state === "accepted")).toBe(true);
  expect(
    send.mock.calls.map(
      (args) => (args as unknown as [{ operation: string }])[0].operation,
    ),
  ).toEqual(["independent", "denied", "child"]);
});

it("only advertises queued client support when the host actually supplies it", () => {
  const bindings = { react: {}, jsx: {}, ui: {} };
  expect(() =>
    assertViewHost({ "client.queue": 1 }, describeViewHost(bindings)),
  ).toThrow("client.queue");
  expect(() =>
    assertViewHost(
      { "client.queue": 1 },
      describeViewHost(bindings, { queuedCommands: true }),
    ),
  ).not.toThrow();
});

it("simulates the same provisional capture and exact-key replay API with permission denial", async () => {
  const { createModuleSimulator } = await import("@suite/module-sdk/simulator");
  const { default: module } = await import("../fixtures/queued-notes/module");
  const { default: server } =
    await import("../fixtures/queued-notes/module-server");
  const sim = createModuleSimulator(module, { server });
  sim.setOnline(false);
  const first = await sim.client.queue("capture", {
    name: "Simulated capture",
  });
  expect(first.state).toBe("pending");
  expect(await sim.client.queued("capture", first.key)).toEqual(first);
  sim.setPermissions([]);
  await expect(sim.client.queued("capture", first.key)).rejects.toThrow(
    "permission",
  );
  sim.setPermissions(module.permissions);
  sim.setOnline(true);
  await sim.sync();
  expect(await sim.client.queued("capture", first.key)).toMatchObject({
    state: "accepted",
    value: { id: expect.any(String) },
  });
  await sim.sync();
  expect(await sim.client.call("names", {})).toEqual(["Simulated capture"]);
});

it("requires both signed original and installed command permissions across releases", async () => {
  const { canAccessCommand } =
    await import("../../packages/client/src/modules/dispatch");
  const { default: original } = await import("../fixtures/queued-notes/module");
  const installed = {
    ...original,
    version: "2.0.0",
    operations: {
      ...original.operations,
      capture: {
        ...original.operations.capture,
        permission: "custom-notes.capture-next",
      },
    },
  };
  const call = {
    moduleId: original.id,
    moduleVersion: original.version,
    operation: "capture",
    action: "operation" as const,
    input: { name: "Saved" },
  };
  const grants = new Set<string>([original.operations.capture.permission]);
  const allowed = (permission: string) => grants.has(permission);
  expect(canAccessCommand(call, installed, original, allowed)).toBe(false);
  grants.clear();
  grants.add(installed.operations.capture.permission);
  expect(canAccessCommand(call, installed, original, allowed)).toBe(false);
  grants.add(original.operations.capture.permission);
  expect(canAccessCommand(call, installed, original, allowed)).toBe(true);
  grants.delete(original.operations.capture.permission);
  expect(canAccessCommand(call, installed, original, allowed)).toBe(false);
  expect(
    canAccessCommand(
      { ...call, moduleVersion: installed.version },
      installed,
      installed,
      allowed,
    ),
  ).toBe(true);
});

it("does not authorize unknown or changed command kinds through a historical contract", async () => {
  const { canAccessCommand } =
    await import("../../packages/client/src/modules/dispatch");
  const { default: original } = await import("../fixtures/queued-notes/module");
  const call = {
    moduleId: original.id,
    moduleVersion: original.version,
    operation: "capture",
    action: "operation" as const,
    input: {},
  };
  const yes = () => true;
  expect(canAccessCommand(call, original, undefined, yes)).toBe(false);
  expect(
    canAccessCommand(
      { ...call, moduleVersion: "0.0.1" },
      original,
      original,
      yes,
    ),
  ).toBe(false);
  expect(
    canAccessCommand({ ...call, moduleId: "foreign" }, original, original, yes),
  ).toBe(false);
  expect(
    canAccessCommand(
      { ...call, operation: "constructor" },
      original,
      original,
      yes,
    ),
  ).toBe(false);
  expect(
    canAccessCommand({ ...call, resource: "notes" }, original, original, yes),
  ).toBe(false);
  for (const changed of [
    { policy: "online" as const },
    { policy: "local" as const },
    { serviceOnly: true },
    { kind: "query" as const },
  ]) {
    const installed = {
      ...original,
      version: "2.0.0",
      operations: {
        ...original.operations,
        capture: { ...original.operations.capture, ...changed },
      },
    };
    expect(canAccessCommand(call, installed, original, yes)).toBe(false);
  }
});

it("permits original-input inspection but never dispatch for removed or reclassified commands", async () => {
  const { canAccessCommand, canInspectCommand } =
    await import("../../packages/client/src/modules/dispatch");
  const { default: original } = await import("../fixtures/queued-notes/module");
  const call = {
    moduleId: original.id,
    moduleVersion: original.version,
    action: "operation" as const,
    operation: "capture",
    input: {},
  };
  for (const change of [
    undefined,
    { policy: "online" as const },
    { policy: "local" as const },
    { kind: "query" as const },
    { serviceOnly: true },
  ]) {
    const installed = {
      ...original,
      version: "2.0.0",
      operations: {
        ...original.operations,
        capture: {
          ...original.operations.capture,
          ...change,
          permission: "custom-notes.capture-next",
        },
      },
    };
    if (!change)
      delete (installed.operations as Record<string, unknown>).capture;
    const grants = new Set([
      original.operations.capture.permission,
      "custom-notes.capture-next",
    ]);
    const allowed = (p: string) => grants.has(p);
    expect(canInspectCommand(call, installed, original, allowed)).toBe(true);
    expect(canAccessCommand(call, installed, original, allowed)).toBe(false);
    grants.delete("custom-notes.capture-next");
    expect(canInspectCommand(call, installed, original, allowed)).toBe(!change);
    grants.delete(original.operations.capture.permission);
    expect(canInspectCommand(call, installed, original, allowed)).toBe(false);
    expect(
      canInspectCommand(
        { ...call, moduleVersion: installed.version },
        installed,
        original,
        () => true,
      ),
    ).toBe(false);
    expect(
      canInspectCommand(
        { ...call, moduleId: "foreign" },
        installed,
        original,
        () => true,
      ),
    ).toBe(false);
    expect(
      canInspectCommand(
        { ...call, resource: "notes" },
        installed,
        original,
        () => true,
      ),
    ).toBe(false);
  }
});
