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

function fixture() {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const keys = generateKeyPairSync("ed25519");
  const pkg = signPackage(
    module,
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
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
      if (request.operation === "moduleArtifact")
        return { status: 200, body: structuredClone(pkg) };
      throw Error("Unexpected request");
    },
  };
  let authority = new NativeInputRecovery(host);
  return {
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
