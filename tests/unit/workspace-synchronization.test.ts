import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { FeatureProps, Platform } from "../../packages/client/src";
import { ApiError } from "../../packages/client/src/api";
import { createModuleCatalog } from "@suite/module-sdk/catalog";
import type { ModuleCall } from "@suite/module-sdk";
import { signPackage } from "../../packages/sdk/node/signing";
import notes from "../fixtures/queued-notes/module";
import {
  changeModuleStorage,
  enqueue,
  readModuleStorage,
} from "../../packages/client/src/modules/storage";
import { synchronizeWorkspace } from "../../packages/shell/src/features/modules/synchronization/host";
import { canDispatchQueuedCall } from "../../packages/client/src/modules/dispatch";

const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const scope = { userId: "user", workspaceId: "workspace" };
const call = (key: string): ModuleCall => ({
  moduleId: notes.id,
  moduleVersion: notes.version,
  action: "operation",
  operation: "capture",
  key,
  input: { name: key },
});
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    onLine: true,
    locks: {
      request: (name: string, run: () => Promise<unknown>) => {
        const next = (locks.get(name) ?? Promise.resolve())
          .catch(() => {})
          .then(run);
        locks.set(name, next);
        return next;
      },
    },
  });
  vi.stubGlobal("localStorage", { getItem: () => "device" });
  const records = new Map<string, unknown>();
  const platform = {
    load: async (_: unknown, key: string) => structuredClone(records.get(key)),
    save: async (_: unknown, key: string, value: unknown) => {
      records.set(key, structuredClone(value));
    },
    pruneModuleArtifacts: async () => {},
  } as unknown as Platform;
  const pkg = signPackage(
    { ...notes, views: undefined, navigation: undefined },
    privateKey,
  );
  await changeModuleStorage(platform, scope, (state) => {
    state.installed[notes.id] = {
      version: pkg.version,
      signed: pkg,
      publicKey,
      artifact: pkg.artifact,
      verifiedAt: Date.now(),
    };
  });
  const state = {
    modules: [pkg.artifact],
    settings: [],
    storage: [],
    installations: [
      {
        module_id: notes.id,
        device_id: "device",
        version: pkg.version,
        state: "installed",
      },
    ],
  };
  const sent: string[] = [];
  let handler = async (key: string): Promise<unknown> => ({ id: key });
  const props = {
    platform,
    scope,
    online: true,
    offlineEnabled: true,
    bootstrap: {
      workspace: { id: scope.workspaceId },
      authorizedAt: new Date().toISOString(),
      offlineHours: 24,
      policyRevision: "1",
      permissions: [...notes.permissions],
      modules: [
        {
          moduleId: notes.id,
          entitled: true,
          assigned: true,
          state: "enabled",
        },
      ],
    },
    // Intentionally empty: no module view has registered its definition.
    moduleCatalog: createModuleCatalog([]),
    onError: vi.fn(),
    client: {
      request: async (request: {
        operation: string;
        idempotencyKey: string;
      }) => {
        if (request.operation === "platformState") return state;
        sent.push(request.idempotencyKey);
        return handler(request.idempotencyKey);
      },
    },
  } as unknown as FeatureProps;
  return {
    props,
    sent,
    state,
    handler: (next: typeof handler) => {
      handler = next;
    },
    capture: (key: string, dependencies: string[] = []) =>
      enqueue(platform, scope, call(key), dependencies),
    read: () => readModuleStorage(platform, scope),
    run: (current: () => FeatureProps | undefined = () => props) =>
      synchronizeWorkspace(current, new AbortController().signal),
  };
}

it("drains dependent commands without a registered view and isolates definitive rejection", async () => {
  const f = await fixture();
  await f.capture("parent-key");
  await f.capture("child-key", ["parent-key"]);
  await f.capture("rejected");
  await f.capture("independent");
  f.handler(async (key) => {
    if (key === "rejected")
      throw new ApiError(422, "MODULE_BUSINESS_ERROR", "Rejected", undefined, {
        moduleId: notes.id,
        operation: "capture",
        error: { reason: "rejected" },
      });
    return { id: key };
  });
  await f.run();
  expect(f.sent).toEqual([
    "parent-key",
    "rejected",
    "independent",
    "child-key",
  ]);
  expect((await f.read()).journal.map((e) => e.state)).toEqual([
    "accepted",
    "accepted",
    "rejected",
    "accepted",
  ]);
  await f.run();
  expect(f.sent).toHaveLength(4);
});

it("serializes concurrent coordinators and retains exact identities after a lost reply", async () => {
  const f = await fixture();
  await f.capture("original");
  let lose = true;
  f.handler(async (key) => {
    if (lose) {
      lose = false;
      throw TypeError("fetch failed");
    }
    return { id: key };
  });
  await f.run();
  expect((await f.read()).journal[0]).toMatchObject({
    state: "pending",
    delivery: "uncertain",
    id: "original",
  });
  await Promise.all([f.run(), f.run()]);
  expect(f.sent).toEqual(["original", "original"]);
  expect((await f.read()).journal[0]).toMatchObject({
    state: "accepted",
    attempts: 2,
  });
});

it("pauses removed installations and revoked command access without changing pending input", async () => {
  const f = await fixture();
  await f.capture("held-key");
  f.state.installations[0].state = "removed";
  await f.run();
  f.state.installations[0].state = "installed";
  f.props.bootstrap.permissions = [];
  await f.run();
  expect(f.sent).toEqual([]);
  expect((await f.read()).journal[0]).toMatchObject({
    attempts: 0,
    delivery: "unsubmitted",
    state: "pending",
  });
  f.props.bootstrap.permissions = [...notes.permissions];
  await f.run();
  expect(f.sent).toEqual(["held-key"]);
});

it.each(["policy", "scope"])(
  "stops the remaining workspace batch on %s loss",
  async (reason) => {
    const f = await fixture();
    await f.capture("first-key");
    await f.capture("second-key");
    let current: FeatureProps | undefined = f.props;
    f.handler(async (key) => {
      if (reason === "scope") current = undefined;
      else f.props.bootstrap.policyRevision = "2";
      return { id: key };
    });
    await f.run(() => current);
    expect(f.sent).toEqual(["first-key"]);
    expect((await f.read()).journal[1]).toMatchObject({
      state: "pending",
      attempts: 0,
    });
  },
);

it("requires original/current command grants and rejects retired or reclassified work", () => {
  const changed = {
    ...notes,
    operations: {
      ...notes.operations,
      capture: { ...notes.operations.capture, permission: "new.capture" },
    },
  };
  expect(
    canDispatchQueuedCall(
      call("x"),
      changed,
      notes,
      (p) => p !== "new.capture",
    ),
  ).toBe(false);
  expect(
    canDispatchQueuedCall(
      call("x"),
      changed,
      notes,
      (p) => p !== "custom-notes.capture",
    ),
  ).toBe(false);
  expect(canDispatchQueuedCall(call("x"), changed, notes, () => true)).toBe(
    true,
  );
  expect(
    canDispatchQueuedCall(
      call("x"),
      { ...notes, operations: {} },
      notes,
      () => true,
    ),
  ).toBe(false);
  expect(
    canDispatchQueuedCall(
      call("x"),
      {
        ...notes,
        operations: {
          ...notes.operations,
          capture: { ...notes.operations.capture, policy: "online" },
        },
      },
      notes,
      () => true,
    ),
  ).toBe(false);
  const resource: ModuleCall = {
    moduleId: notes.id,
    moduleVersion: notes.version,
    resource: "notes",
    action: "create",
    input: {},
  };
  expect(canDispatchQueuedCall(resource, notes, notes, () => true)).toBe(true);
  expect(
    canDispatchQueuedCall(
      resource,
      { ...notes, resources: {} },
      notes,
      () => true,
    ),
  ).toBe(false);
  expect(
    canDispatchQueuedCall(resource, notes, notes, (p) => !p.endsWith(".read")),
  ).toBe(false);
});

it("leaves unavailable historical contracts pending while independent work completes", async () => {
  const f = await fixture();
  await f.capture("missing-version");
  await f.capture("independent");
  await changeModuleStorage(f.props.platform, scope, (state) => {
    state.journal[0].call.moduleVersion = "0.0.1";
  });
  const result = await f.run();
  expect(result.errors).toHaveLength(1);
  expect(f.sent).toEqual(["independent"]);
  expect((await f.read()).journal[0]).toMatchObject({
    attempts: 0,
    delivery: "unsubmitted",
    state: "pending",
  });
});

it("orders generated resource writes before dependent custom commands in one pass", async () => {
  const f = await fixture();
  const id = crypto.randomUUID();
  await enqueue(f.props.platform, scope, {
    moduleId: notes.id,
    moduleVersion: notes.version,
    resource: "notes",
    action: "create",
    key: "resource-parent",
    input: { id, data: { name: "Resource parent" } },
  });
  await f.capture("command-child", ["resource-parent"]);
  f.handler(async (key) =>
    key === "resource-parent"
      ? {
          id,
          data: { name: "Resource parent" },
          version: 1,
          archived: false,
          updatedAt: new Date().toISOString(),
        }
      : { id: key },
  );
  await f.run();
  expect(f.sent).toEqual(["resource-parent", "command-child"]);
  expect((await f.read()).journal.map((entry) => entry.state)).toEqual([
    "accepted",
    "accepted",
  ]);
});

it("does not apply a late authentication failure to a different active workspace", async () => {
  const f = await fixture();
  await f.capture("late-auth-failure");
  let current = f.props;
  f.handler(async () => {
    current = {
      ...f.props,
      scope: { ...scope, workspaceId: "another-workspace" },
    };
    throw new ApiError(401, "UNAUTHENTICATED", "Sign in again");
  });
  await f.run(() => current);
  expect(f.props.onError).not.toHaveBeenCalled();
  expect((await f.read()).journal[0]).toMatchObject({
    state: "pending",
    delivery: "uncertain",
  });
});
