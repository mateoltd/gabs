import { expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { defineModule, hydrateModule } from "@suite/module-sdk";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import { canonical } from "@suite/module-sdk/registry";
import { capabilityContractDigest } from "@suite/module-sdk/capability-leases";
import { signPackage } from "@suite/module-sdk/node/signing";
import type {
  Bootstrap,
  OperationRequest,
} from "../../packages/contracts/src/index";
import {
  NativeCapabilityAuthority,
  CapabilityTransportUnavailable,
  isCapabilityTransportFailure,
} from "../../apps/desktop/src/main/capability-authority";
import base from "../fixtures/local-capabilities";
const module = defineModule({
  ...base,
  capabilities: {
    ...base.capabilities,
    export: { ...base.capabilities.export, offline: "lease" },
  },
});
const call = {
  moduleId: module.id,
  moduleVersion: module.version,
  capability: "export",
  input: { filename: "notes.txt", content: "Retained work" },
};
function fixture(
  kind: "files.export" | "lan.status" | "lan.relay" = "files.export",
) {
  const module = defineModule({
    ...base,
    capabilities: {
      ...base.capabilities,
      export: { ...base.capabilities.export, kind, offline: "lease" },
    },
  });
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const authority = {
    publicKey,
    issuer: "https://api.suite.test",
    keyId: createHash("sha256")
      .update(keys.publicKey.export({ type: "spki", format: "der" }))
      .digest("hex"),
  };
  const pkg = signPackage(
    module,
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
  const values = new Map<string, unknown>();
  let currentUser: string | undefined = scope.userId;
  let connected = true,
    available = true,
    status = 200;
  const policy: Bootstrap = {
    workspace: {
      id: scope.workspaceId,
      name: "Native company",
      kind: "company",
      currency: "EUR",
    },
    permissions: [...module.permissions],
    roleNames: ["Owner"],
    modules: [
      {
        moduleId: module.id,
        state: "enabled",
        entitled: true,
        assigned: true,
        accessPolicy: "self",
      },
    ],
    offlineHours: 24,
    authorizedAt: new Date().toISOString(),
    policyRevision: "3",
    seatLimit: 10,
    memberCount: 1,
  };
  const requests: OperationRequest[] = [];
  const host = {
    issuer: authority.issuer,
    currentUser: () => currentUser,
    available: () => available,
    read: async (key: string) => structuredClone(values.get(key)),
    write: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    },
    purge: async (prefix: string) => {
      for (const key of values.keys())
        if (key.startsWith(prefix + "/")) values.delete(key);
    },
    request: async (request: OperationRequest) => {
      requests.push(structuredClone(request));
      if (!connected) throw new CapabilityTransportUnavailable("Disconnected");
      if (status !== 200)
        return { status, body: { message: "Server rejection" } };
      if (request.operation === "bootstrap")
        return { status: 200, body: structuredClone(policy) };
      if (request.operation === "moduleTrust")
        return { status: 200, body: { publicKey } };
      if (request.operation === "moduleArtifact")
        return { status: 200, body: structuredClone(pkg) };
      if (request.operation === "capabilityLeaseKey")
        return { status: 200, body: authority };
      if (request.operation === "moduleCapabilityAuthorize")
        return {
          status: 200,
          body: {
            ...scope,
            moduleId: module.id,
            moduleVersion: module.version,
            capability: "export",
            kind,
          },
        };
      if (request.operation !== "moduleCapabilityLease")
        throw Error("Unexpected operation");
      const payload = {
        purpose: "suite:corporate-device:v1",
        id: randomUUID(),
        ...scope,
        membershipId: randomUUID(),
        issuer: authority.issuer,
        moduleId: module.id,
        moduleVersion: module.version,
        capability: "export",
        kind,
        permission: module.capabilities!.export.permission,
        contractDigest: await capabilityContractDigest(
          hydrateModule(moduleContract(pkg.artifact)),
        ),
        policyRevision: policy.policyRevision!,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
      };
      return {
        status: 200,
        body: {
          payload,
          keyId: authority.keyId,
          signature: sign(
            null,
            Buffer.from(canonical(payload)),
            keys.privateKey,
          ).toString("base64"),
        },
      };
    },
  };
  let manager = new NativeCapabilityAuthority(host);
  return {
    scope,
    module,
    policy,
    values,
    requests,
    pkg,
    get manager() {
      return manager;
    },
    restart: (issuer = host.issuer) => {
      manager = new NativeCapabilityAuthority({ ...host, issuer });
    },
    online: (value: boolean) => {
      connected = value;
    },
    storage: (value: boolean) => {
      available = value;
    },
    response: (value: number) => {
      status = value;
    },
    user: (value?: string) => {
      currentUser = value;
    },
    prepare: () => manager.prepare(scope, module.id, module.version, true),
    authorize: () => manager.authorize(scope, call),
  };
}
it("acquires independent signed authority, persists across restart and rechecks an offline action", async () => {
  const f = fixture();
  const ready = await f.prepare();
  expect(ready.expiresAt).toBeGreaterThan(Date.now());
  expect(ready.capabilities).toEqual(["export"]);
  expect(f.requests.map((r) => r.operation)).toEqual([
    "bootstrap",
    "moduleTrust",
    "moduleArtifact",
    "capabilityLeaseKey",
    "moduleCapabilityLease",
  ]);
  f.online(false);
  f.restart();
  expect((await f.prepare()).expiresAt).toBeGreaterThan(Date.now());
  const action = await f.authorize();
  expect(action.authorization).toMatchObject({
    ...f.scope,
    kind: "files.export",
  });
  await expect(action.recheck()).resolves.toEqual(action.authorization);
  await expect(
    f.manager.authorize(f.scope, {
      ...call,
      capability: "notify",
      input: { title: "Title", message: "Body" },
    }),
  ).rejects.toThrow();
});
it("invalidates an open action on policy revocation, expiry, opt-out and profile change", async () => {
  for (const change of ["policy", "expiry", "opt-out", "profile"] as const) {
    const f = fixture();
    await f.prepare();
    f.online(false);
    const action = await f.authorize();
    if (change === "policy")
      await f.manager.observe(f.scope, {
        ...f.policy,
        permissions: [],
        policyRevision: "4",
      });
    if (change === "expiry")
      await f.manager.observe(f.scope, {
        ...f.policy,
        authorizedAt: new Date(Date.now() - 25 * 3600000).toISOString(),
      });
    if (change === "opt-out")
      await f.manager.prepare(f.scope, module.id, module.version, false);
    if (change === "profile") f.user(randomUUID());
    await expect(action.recheck()).rejects.toThrow();
  }
});
it("does not use a lease after a known server denial and requires connected renewal to recover", async () => {
  const f = fixture();
  await f.prepare();
  f.response(403);
  await expect(f.authorize()).rejects.toThrow("Server rejection");
  f.online(false);
  f.restart();
  await expect(f.authorize()).rejects.toThrow();
  f.online(true);
  f.response(200);
  await f.prepare();
  f.online(false);
  await expect(f.authorize()).resolves.toBeDefined();
});
it("keeps online actions available without protected storage but denies offline fallback", async () => {
  const f = fixture();
  f.storage(false);
  await expect(f.authorize()).resolves.toBeDefined();
  await expect(f.prepare()).rejects.toThrow(/Protected storage/);
  f.online(false);
  await expect(f.authorize()).rejects.toThrow(/Protected storage/);
});
it("rejects modified signed packages, mismatched releases and foreign profile use", async () => {
  const f = fixture();
  f.pkg.digest = "0".repeat(64);
  await expect(f.prepare()).rejects.toThrow(/checksum/);
  const other = fixture();
  await expect(
    other.manager.prepare(other.scope, module.id, "2.0.0", true),
  ).rejects.toThrow(/release changed/);
  await expect(
    other.manager.prepare(
      { ...other.scope, userId: randomUUID() },
      module.id,
      module.version,
      true,
    ),
  ).rejects.toThrow(/profile/);
});
it("preserves public issuer trust when removing native workspace authority", async () => {
  const f = fixture();
  await f.prepare();
  f.online(false);
  const action = await f.authorize();
  await f.manager.purge(f.scope);
  await expect(action.recheck()).rejects.toThrow();
  expect(f.values.has("capabilities/issuers/trust")).toBe(true);
  f.restart();
  await expect(f.authorize()).rejects.toThrow(/Reconnect/);
});
it("ignores older policy responses and does not interrupt actions for an unchanged policy", async () => {
  const f = fixture();
  await f.prepare();
  f.online(false);
  const action = await f.authorize();
  await f.manager.observe(f.scope, f.policy);
  await expect(action.recheck()).resolves.toBeDefined();
  await f.manager.observe(f.scope, {
    ...f.policy,
    policyRevision: "4",
    permissions: [],
  });
  await f.manager.observe(f.scope, f.policy);
  await expect(f.authorize()).rejects.toThrow();
});
it("classifies network transport failures without treating TLS, programming or HTTP errors as offline", () => {
  expect(
    isCapabilityTransportFailure(
      new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
    ),
  ).toBe(true);
  expect(
    isCapabilityTransportFailure(
      new TypeError("fetch failed", { cause: { code: "CERT_HAS_EXPIRED" } }),
    ),
  ).toBe(false);
  expect(isCapabilityTransportFailure(new TypeError("Invalid request"))).toBe(
    false,
  );
  expect(isCapabilityTransportFailure(new Error("HTTP 403"))).toBe(false);
});

it("does not reuse a previous API server's native authority after a configuration change", async () => {
  const f = fixture();
  await f.prepare();
  f.online(false);
  f.restart("https://other.suite.test");
  await expect(f.authorize()).rejects.toThrow(/Reconnect/);
  f.online(true);
  await expect(f.prepare()).rejects.toThrow(/configured API server/);
  f.online(false);
  await expect(f.authorize()).rejects.toThrow(/permissions/);
});

it("starts module LAN authority online and from protected signed state after restart without administrator permission", async () => {
  const f = fixture("lan.relay");
  const selection = {
    moduleId: f.module.id,
    moduleVersion: f.module.version,
    capability: "export",
  };
  expect(f.policy.permissions).not.toContain("modules.manage");
  expect(await f.manager.authorizeLan(f.scope, selection)).toBeGreaterThan(
    Date.now(),
  );
  await f.prepare();
  f.online(false);
  f.restart();
  expect(await f.manager.authorizeLan(f.scope, selection)).toBeGreaterThan(
    Date.now(),
  );
  await expect(
    f.manager.authorizeLan(
      { ...f.scope, workspaceId: randomUUID() },
      selection,
    ),
  ).rejects.toThrow();
  await expect(
    f.manager.authorizeLan(f.scope, { ...selection, moduleVersion: "9.0.0" }),
  ).rejects.toThrow();
  await expect(
    f.manager.authorizeLan(f.scope, { ...selection, capability: "missing" }),
  ).rejects.toThrow();
  f.online(true);
  f.response(403);
  await expect(f.manager.authorizeLan(f.scope, selection)).rejects.toThrow(
    /rejection/,
  );
  f.online(false);
  f.restart();
  await expect(f.manager.authorizeLan(f.scope, selection)).rejects.toThrow(
    /permissions|revoked|lease/,
  );
});
it.each(["files.export", "lan.status"] as const)(
  "rejects %s as session startup authority, including a valid signed offline grant",
  async (kind) => {
    const f = fixture(kind);
    const selection = {
      moduleId: f.module.id,
      moduleVersion: f.module.version,
      capability: "export",
    };
    await expect(f.manager.authorizeLan(f.scope, selection)).rejects.toThrow(
      /relay grant/,
    );
    await f.prepare();
    f.online(false);
    f.restart();
    await expect(f.manager.authorizeLan(f.scope, selection)).rejects.toThrow(
      /relay grant/,
    );
  },
);

it.each([
  "expired",
  "clock rollback",
  "opt out",
  "revoked permission",
  "different profile",
] as const)("rejects offline LAN startup after %s", async (change) => {
  const f = fixture("lan.relay");
  const selection = {
    moduleId: f.module.id,
    moduleVersion: f.module.version,
    capability: "export",
  };
  await f.prepare();
  f.online(false);
  f.restart();
  try {
    if (change === "expired" || change === "clock rollback") {
      const now = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(now + (change === "expired" ? 65000 : -300000));
    }
    if (change === "opt out")
      await f.manager.prepare(f.scope, f.module.id, f.module.version, false);
    if (change === "revoked permission")
      await f.manager.observe(f.scope, {
        ...f.policy,
        permissions: [],
        policyRevision: "4",
      });
    if (change === "different profile") f.user(randomUUID());
    await expect(f.manager.authorizeLan(f.scope, selection)).rejects.toThrow();
  } finally {
    vi.useRealTimers();
  }
});
it("allows connected module startup when offline storage is disabled, but never falls back without a lease", async () => {
  const f = fixture("lan.relay");
  f.policy.offlineHours = 0;
  f.storage(false);
  const selection = {
    moduleId: f.module.id,
    moduleVersion: f.module.version,
    capability: "export",
  };
  expect(await f.manager.authorizeLan(f.scope, selection)).toBeGreaterThan(
    Date.now(),
  );
  f.online(false);
  await expect(f.manager.authorizeLan(f.scope, selection)).rejects.toThrow(
    /Protected storage/,
  );
});

const recoveryCall = (id: string, version: string) => ({
  moduleId: id,
  moduleVersion: version,
  action: "create" as const,
  resource: "notes",
  input: { data: { name: "Retained receipt" } },
});
it("requires both a signed relay grant and resource read access for employee recovery", async () => {
  const f = fixture("lan.relay");
  const call = recoveryCall(f.module.id, f.module.version);
  expect(f.policy.permissions).not.toContain("modules.manage");
  const connected = await f.manager.lanRecoveryAccess(f.scope);
  expect(connected).toMatchObject({ administrative: false, online: true });
  expect(await connected.allows(call)).toBe(true);
  await connected.check();
  const reads = f.requests.filter(
    (r) => r.operation === "moduleArtifact",
  ).length;
  expect(await connected.allows({ ...call, moduleId: "foreign-module" })).toBe(
    false,
  );
  expect(
    f.requests.filter((r) => r.operation === "moduleArtifact"),
  ).toHaveLength(reads);
  await f.prepare();
  f.online(false);
  f.restart();
  const offline = await f.manager.lanRecoveryAccess(f.scope);
  expect(offline).toMatchObject({ administrative: false, online: false });
  expect(await offline.allows(call)).toBe(true);
  await offline.check();
  await f.manager.observe(f.scope, {
    ...f.policy,
    permissions: f.policy.permissions.filter(
      (p) => p !== `${f.module.id}.notes.read`,
    ),
  });
  await expect(offline.check()).rejects.toThrow(/permissions/);
  expect(await (await f.manager.lanRecoveryAccess(f.scope)).allows(call)).toBe(
    false,
  );
});
it.each(["lan.status", "files.export"] as const)(
  "does not treat a %s lease as permission to read received drafts",
  async (kind) => {
    const f = fixture(kind);
    await f.prepare();
    for (const online of [true, false]) {
      f.online(online);
      f.restart();
      const access = await f.manager.lanRecoveryAccess(f.scope);
      expect(
        await access.allows(recoveryCall(f.module.id, f.module.version)),
      ).toBe(false);
      await access.check();
    }
  },
);
it.each(["read", "relay", "assignment"] as const)(
  "rechecks employee %s authority even when a policy revision does not change",
  async (change) => {
    const f = fixture("lan.relay");
    const access = await f.manager.lanRecoveryAccess(f.scope);
    expect(
      await access.allows(recoveryCall(f.module.id, f.module.version)),
    ).toBe(true);
    if (change === "assignment") f.policy.modules[0].assigned = false;
    else
      f.policy.permissions = f.policy.permissions.filter(
        (p) =>
          p !== `${f.module.id}.${change === "read" ? "notes.read" : "export"}`,
      );
    await expect(access.check()).rejects.toThrow(/permissions/);
  },
);
it("expires a held offline receipt action and denies connected revocation after restart", async () => {
  const f = fixture("lan.relay");
  await f.prepare();
  f.online(false);
  f.restart();
  const access = await f.manager.lanRecoveryAccess(f.scope);
  expect(await access.allows(recoveryCall(f.module.id, f.module.version))).toBe(
    true,
  );
  try {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 65000);
    await expect(access.check()).rejects.toThrow(/expired|lease/);
  } finally {
    vi.useRealTimers();
  }
  f.online(true);
  f.response(403);
  await expect(f.manager.lanRecoveryAccess(f.scope)).rejects.toThrow(
    /rejection/,
  );
  f.online(false);
  f.restart();
  await expect(f.manager.lanRecoveryAccess(f.scope)).rejects.toThrow(
    /Reconnect/,
  );
});
it("does not give offline administrators blanket receipt access", async () => {
  const f = fixture("lan.status");
  f.policy.permissions.push("modules.manage");
  const online = await f.manager.lanRecoveryAccess(f.scope);
  expect(online.administrative).toBe(true);
  await f.prepare();
  f.online(false);
  f.restart();
  const offline = await f.manager.lanRecoveryAccess(f.scope);
  expect(offline.administrative).toBe(false);
  expect(
    await offline.allows(recoveryCall(f.module.id, f.module.version)),
  ).toBe(false);
});
