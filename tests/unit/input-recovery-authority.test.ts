import queuedDefinition from "../fixtures/queued-notes/module";
const queuedModule = { ...queuedDefinition, views: {}, navigation: undefined };
import type { ModuleDefinition } from "@suite/module-sdk";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { signPackage } from "@suite/module-sdk/node/signing";
import type { ModuleInputRecovery } from "@suite/module-sdk/platform";
import type {
  Bootstrap,
  OperationRequest,
} from "../../packages/contracts/src/index";
import { NativeInputRecovery } from "../../apps/desktop/src/main/input-recovery";
import { CapabilityTransportUnavailable } from "../../apps/desktop/src/main/capability-authority";
import { validateRecoveryInput } from "../../packages/client/src/recovery/input";
import module from "../fixtures/local-capabilities";

function fixture(selected: ModuleDefinition = module) {
  const module = selected;
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const keys = generateKeyPairSync("ed25519");
  let pkg = signPackage(
    module,
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  const releases = new Map([[module.version, pkg]]);
  const policy: Bootstrap = {
    workspace: {
      id: scope.workspaceId,
      name: "Recovery",
      kind: "company",
      currency: "EUR",
    },
    permissions: [...module.permissions],
    roleNames: [],
    modules: [
      {
        moduleId: module.id,
        state: "enabled",
        assigned: true,
        entitled: true,
        accessPolicy: "self",
      },
    ],
    offlineHours: 24,
    seatLimit: 5,
    memberCount: 1,
    authorizedAt: new Date().toISOString(),
    policyRevision: "1",
  };
  const input: ModuleInputRecovery = {
    kind: "module-input-recovery",
    ...scope,
    moduleId: module.id,
    moduleVersion: module.version,
    resource: "notes",
    input: { data: { name: "Keep me" } },
    status: "unsaved",
  };
  const values = new Map<string, unknown>();
  let user: string | undefined = scope.userId,
    connected = true,
    available = true,
    status = 200;
  const host = {
    issuer: "https://api.example.test",
    currentUser: () => user,
    available: () => available,
    read: async (key: string) => structuredClone(values.get(key)),
    write: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
    purge: async (prefix: string) => {
      for (const k of values.keys())
        if (k.startsWith(prefix + "/")) values.delete(k);
    },
    request: async (request: OperationRequest) => {
      if (!connected) throw new CapabilityTransportUnavailable("Offline");
      if (status !== 200) return { status, body: { message: "Denied" } };
      if (request.operation === "bootstrap")
        return { status: 200, body: structuredClone(policy) };
      if (request.operation === "moduleReceiptArtifact")
        return {
          status: 200,
          body: structuredClone(releases.get(String(request.query?.version))),
        };
      if (request.operation === "moduleArtifact")
        return { status: 200, body: structuredClone(pkg) };
      throw Error("Unexpected request");
    },
  };
  let authority = new NativeInputRecovery(host);
  return {
    release(value: ModuleDefinition) {
      pkg = signPackage(
        value,
        keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      );
      releases.set(value.version, pkg);
    },
    scope,
    input,
    policy,
    pkg,
    values,
    host,
    get authority() {
      return authority;
    },
    restart() {
      authority = new NativeInputRecovery(host);
    },
    offline() {
      connected = false;
    },
    online() {
      connected = true;
    },
    user(value?: string) {
      user = value;
    },
    deny() {
      status = 403;
    },
    unprotected() {
      available = false;
    },
    authorize: () => authority.authorize(scope, input, () => {}),
  };
}
afterEach(() => vi.restoreAllMocks());
it("binds recovery metadata, including uncertain releases, to the host session", () => {
  const f = fixture();
  expect(() =>
    validateRecoveryInput(
      { ...f.input, userId: randomUUID() },
      f.scope,
      module.id,
    ),
  ).toThrow();
  expect(() =>
    validateRecoveryInput(
      { ...f.input, workspaceId: randomUUID() },
      f.scope,
      module.id,
    ),
  ).toThrow();
  expect(() =>
    validateRecoveryInput(
      { ...f.input, moduleId: "other" },
      f.scope,
      module.id,
    ),
  ).toThrow();
  expect(() =>
    validateRecoveryInput(
      {
        ...f.input,
        status: "unconfirmed",
        pendingRequest: {
          moduleId: module.id,
          moduleVersion: "2.0.0",
          resource: "notes",
          key: "original",
          action: "create",
          input: { id: "record", data: {} },
        },
      },
      f.scope,
      module.id,
    ),
  ).toThrow();
});
it("requires current resource read, assignment, entitlement and module readiness, without granting writes", async () => {
  const f = fixture();
  f.policy.permissions = [`${module.id}.notes.read`];
  await f.authorize();
  for (const change of [
    () => {
      f.policy.permissions = [];
    },
    () => {
      f.policy.modules[0].assigned = false;
    },
    () => {
      f.policy.modules[0].entitled = false;
    },
    () => {
      f.policy.modules[0].state = "suspended";
    },
  ]) {
    f.policy.permissions = [`${module.id}.notes.read`];
    Object.assign(f.policy.modules[0], {
      assigned: true,
      entitled: true,
      state: "enabled",
    });
    change();
    f.policy.policyRevision = String(Number(f.policy.policyRevision) + 1);
    await expect(f.authorize()).rejects.toThrow("Current access");
  }
});
it("preserves protected offline authority through restart but requires consent, unexpired policy and monotonic observed time", async () => {
  const f = fixture();
  await f.authorize();
  await f.authority.setOffline(f.scope, true);
  f.restart();
  f.offline();
  await f.authorize();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now - 1000);
  await expect(f.authorize()).rejects.toThrow("Reconnect");
  vi.restoreAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(now + 25 * 3600000);
  await expect(f.authorize()).rejects.toThrow("expired");
  vi.restoreAllMocks();
  await f.authority.setOffline(f.scope, false);
  expect(f.values.size).toBe(0);
  f.restart();
  await expect(f.authorize()).rejects.toThrow("Reconnect");
});
it("never falls back from server denial and retains denial across offline restart", async () => {
  const f = fixture();
  await f.authorize();
  await f.authority.setOffline(f.scope, true);
  f.deny();
  await expect(f.authorize()).rejects.toThrow("server access");
  f.restart();
  f.offline();
  await expect(f.authorize()).rejects.toThrow("Reconnect");
});
it("rejects changed profiles, closed sessions and a different configured issuer", async () => {
  const f = fixture();
  await f.authorize();
  await f.authority.setOffline(f.scope, true);
  await expect(
    f.authority.authorize(f.scope, f.input, () => {
      throw Error("Closed session");
    }),
  ).rejects.toThrow("Closed session");
  f.user(randomUUID());
  await expect(f.authorize()).rejects.toThrow("profile");
  f.user(f.scope.userId);
  f.host.issuer = "https://another.example.test";
  f.restart();
  f.offline();
  await expect(f.authorize()).rejects.toThrow("Reconnect");
});
it("online recovery works without protected storage while offline recovery fails closed", async () => {
  const f = fixture();
  f.unprotected();
  await f.authorize();
  await f.authority.setOffline(f.scope, true);
  f.offline();
  await expect(f.authorize()).rejects.toThrow("Reconnect");
});
it("purge fences an in-flight response so it cannot repopulate a removed profile", async () => {
  const f = fixture();
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const request = f.host.request;
  f.host.request = async (req) => {
    const result = await request(req);
    await held;
    return result;
  };
  const pending = f.authorize();
  await f.authority.purge(f.scope);
  release();
  await expect(pending).rejects.toThrow("profile");
  expect(f.values.size).toBe(0);
});

it("new policy revisions discard stale dependency metadata and reject late artifact responses", async () => {
  const f = fixture();
  await f.authorize();
  await f.authority.setOffline(f.scope, true);
  f.policy.policyRevision = "2";
  await f.authority.observe(f.scope, f.policy);
  await expect(
    f.authority.observeArtifact(f.scope, f.pkg, "1"),
  ).rejects.toThrow("policy changed");
  f.offline();
  await expect(f.authorize()).rejects.toThrow("dependencies");
  await expect(
    f.authority.observeCatalog(f.scope, { modules: [f.pkg.artifact] }, "1"),
  ).rejects.toThrow("policy changed");
  await f.authority.observeCatalog(f.scope, { modules: [f.pkg.artifact] }, "2");
  f.restart();
  await f.authorize();
  f.online();
  await f.authorize();
  f.offline();
  await f.authorize();
});

it("administrator shortening or disabling offline access applies to retained authority", async () => {
  const f = fixture();
  await f.authorize();
  await f.authority.setOffline(f.scope, true);
  f.policy.offlineHours = 1;
  await f.authority.observe(f.scope, f.policy);
  f.offline();
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 2 * 3600000);
  await expect(f.authorize()).rejects.toThrow("expired");
  vi.restoreAllMocks();
  f.policy.offlineHours = 0;
  await f.authority.observe(f.scope, f.policy);
  await expect(f.authorize()).rejects.toThrow("expired");
});

it("authorizes historical command exports using host-observed contracts through restart and rejects current or original grant loss", async () => {
  const f = fixture(queuedModule);
  const call = {
    moduleId: queuedModule.id,
    moduleVersion: queuedModule.version,
    action: "operation" as const,
    operation: "capture",
    key: randomUUID(),
    input: { name: "Preserve" },
  };
  const work: SavedWorkRecovery = {
    kind: "module-work-recovery",
    formatVersion: 1,
    ...f.scope,
    moduleId: queuedModule.id,
    moduleVersion: queuedModule.version,
    selection: "request",
    entry: {
      ...f.scope,
      id: call.key,
      call,
      dependencies: [],
      state: "rejected",
      createdAt: Date.now(),
      attempts: 1,
    },
  };
  const current = {
    ...queuedModule,
    version: "2.0.0",
    permissions: [...queuedModule.permissions, "custom-notes.new-grant"],
    operations: {
      ...queuedModule.operations,
      capture: {
        ...queuedModule.operations.capture,
        permission: "custom-notes.new-grant",
      },
    },
  };
  // Downloads may precede bootstrap. Retain their immutable source contracts
  // without treating them as the currently selected corporate release.
  await f.authority.observeArtifact(f.scope, f.pkg, undefined, false);
  f.release(current);
  await f.authority.setOffline(f.scope, true);
  await f.authority.observe(f.scope, f.policy);
  await f.authority.observeCatalog(f.scope, { modules: [current] }, "1");
  f.offline();
  f.restart();
  await expect(f.authority.authorize(f.scope, work, () => {})).rejects.toThrow(
    /command/,
  );
  f.online();
  f.policy.permissions.push("custom-notes.new-grant");
  await f.authority.authorize(f.scope, work, () => {});
  f.offline();
  f.restart();
  await f.authority.authorize(f.scope, work, () => {});
  const forged = structuredClone(work);
  forged.entry.call = { ...call, operation: "names" };
  await expect(
    f.authority.authorize(f.scope, forged, () => {}),
  ).rejects.toThrow(/command/);
  f.online();
  f.policy.permissions = f.policy.permissions.filter(
    (p) => p !== queuedModule.operations.capture.permission,
  );
  await expect(f.authority.authorize(f.scope, work, () => {})).rejects.toThrow(
    /command/,
  );
  f.offline();
  f.restart();
  await expect(f.authority.authorize(f.scope, work, () => {})).rejects.toThrow(
    /command/,
  );
});

it.each(["platformState", "moduleArtifact", "moduleReceiptArtifact"] as const)(
  "discards delayed successful %s metadata without revoking a newer prepared policy",
  async (operation) => {
    const f = fixture();
    await f.authorize();
    await f.authority.setOffline(f.scope, true);
    f.policy.policyRevision = "2";
    await f.authorize();
    const before = structuredClone([...f.values]);
    const body =
      operation === "platformState" ? { modules: [f.pkg.artifact] } : f.pkg;
    await f.authority.observeResponse(
      f.scope,
      operation,
      { status: 200, body },
      "1",
    );
    // Invalid obsolete content is discarded before parsing; it cannot replace or revoke newer metadata.
    await f.authority.observeResponse(
      f.scope,
      operation,
      { status: 200, body: {} },
      "1",
    );
    expect([...f.values]).toEqual(before);
    f.offline();
    f.restart();
    await f.authorize();
  },
);

it.each(["platformState", "moduleArtifact", "moduleReceiptArtifact"] as const)(
  "still revokes offline recovery after malformed current %s metadata",
  async (operation) => {
    const f = fixture();
    await f.authorize();
    await f.authority.setOffline(f.scope, true);
    await f.authority.observeResponse(
      f.scope,
      operation,
      { status: 200, body: {} },
      "1",
    );
    f.offline();
    f.restart();
    await expect(f.authorize()).rejects.toThrow("Reconnect");
  },
);

it.each([401, 403, 426])(
  "preserves a real %s denial even when the request started under an older policy",
  async (status) => {
    const f = fixture();
    await f.authorize();
    await f.authority.setOffline(f.scope, true);
    f.policy.policyRevision = "2";
    await f.authorize();
    await f.authority.observeResponse(
      f.scope,
      "platformState",
      { status, body: {} },
      "1",
    );
    await f.authority.observeResponse(
      f.scope,
      "platformState",
      { status: 200, body: { modules: [f.pkg.artifact] } },
      "1",
    );
    f.offline();
    f.restart();
    await expect(f.authorize()).rejects.toThrow("Reconnect");
  },
);

it("rechecks prepared archive authority against received denials, shortened leases and profile changes", async () => {
  const f = fixture();
  await f.authority.setOffline(f.scope, true);
  await f.authorize();
  f.offline();
  const guard = await f.authorize();
  expect(() => guard()).not.toThrow();
  await f.authority.observe(f.scope, {
    ...f.policy,
    policyRevision: "2",
    offlineHours: 0,
  });
  expect(() => guard()).toThrow();
  f.online();
  const online = await f.authorize();
  await f.authority.revoke(f.scope);
  expect(() => online()).toThrow(/Reconnect/);
  f.user();
  expect(() => online()).toThrow(/profile/);
});
