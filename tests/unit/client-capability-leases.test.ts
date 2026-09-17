import { expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { defineModule } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import {
  capabilityContractDigest,
  type CapabilityLeasePayload,
} from "@suite/module-sdk/capability-leases";
import {
  CorporateCapabilityLeases,
  type CapabilityLeaseStorage,
  type CapabilityLeaseAccess,
} from "../../packages/client/src/identity/capability-leases";
import type { Scope } from "../../packages/client/src/index";
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
  input: { filename: "notes.txt", content: "Retained notes" },
};
function keys() {
  const key = generateKeyPairSync("ed25519");
  return {
    privateKey: key.privateKey,
    authority: {
      issuer: "https://api.suite.test",
      keyId: createHash("sha256")
        .update(key.publicKey.export({ type: "spki", format: "der" }))
        .digest("hex"),
      publicKey: key.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    },
  };
}
class MemoryStorage implements CapabilityLeaseStorage {
  values = new Map<string, unknown>();
  pending = new Map<string, Promise<unknown>>();
  beforeSave?: () => Promise<void>;
  key(scope: Scope) {
    return JSON.stringify(scope);
  }
  async load(scope: Scope) {
    return structuredClone(this.values.get(this.key(scope)));
  }
  async save(scope: Scope, value: unknown) {
    await this.beforeSave?.();
    this.values.set(this.key(scope), structuredClone(value));
  }
  exclusive<T>(scope: Scope, task: () => Promise<T>): Promise<T> {
    const key = this.key(scope);
    const next = (this.pending.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(task);
    this.pending.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }
}
async function fixture(storage = new MemoryStorage()) {
  const scope = { userId: randomUUID(), workspaceId: randomUUID() };
  let reading = { wall: 100000, monotonic: 0 },
    active = true;
  let signer = keys();
  let access: CapabilityLeaseAccess = {
    policyRevision: "3",
    offlineEnabled: true,
    expiresAt: 200000,
  };
  const clock = () => ({ ...reading });
  const manager = new CorporateCapabilityLeases(storage, clock);
  const live = () => {
    if (!active) throw Error("Profile locked or view closed");
    return { ...access };
  };
  async function issue(change: Partial<CapabilityLeasePayload> = {}) {
    const payload: CapabilityLeasePayload = {
      purpose: "suite:corporate-device:v1",
      id: randomUUID(),
      issuer: signer.authority.issuer,
      membershipId: randomUUID(),
      ...scope,
      moduleId: module.id,
      moduleVersion: module.version,
      capability: "export",
      kind: "files.export",
      permission: base.capabilities.export.permission,
      contractDigest: await capabilityContractDigest(module),
      policyRevision: access.policyRevision,
      issuedAt: reading.wall,
      expiresAt: reading.wall + 60000,
      ...change,
    };
    return {
      authority: signer.authority,
      lease: {
        payload,
        keyId: signer.authority.keyId,
        signature: sign(
          null,
          Buffer.from(canonical(payload)),
          signer.privateKey,
        ).toString("base64"),
      },
    };
  }
  const refresh = async () =>
    manager.refresh(scope, module, "export", live, issue);
  const prepare = () => manager.prepare(scope, module, call, live);
  await manager.observePolicy(scope, "3", true);
  await refresh();
  return {
    manager,
    storage,
    scope,
    live,
    prepare,
    refresh,
    issue,
    clock,
    setClock: (next: typeof reading) => {
      reading = next;
    },
    setAccess: (next: Partial<CapabilityLeaseAccess>) => {
      access = { ...access, ...next };
    },
    close: () => {
      active = false;
    },
    rotate: () => {
      signer = keys();
    },
  };
}

it("retains signed grants across restart and isolates accounts, workspaces and exact release contracts", async () => {
  const f = await fixture();
  expect((await f.prepare()).authorization).toMatchObject({
    ...f.scope,
    capability: "export",
  });
  const restarted = new CorporateCapabilityLeases(f.storage, f.clock);
  expect(
    (await restarted.prepare(f.scope, module, call, f.live)).authorization
      .moduleId,
  ).toBe(module.id);
  for (const scope of [
    { ...f.scope, userId: randomUUID() },
    { ...f.scope, workspaceId: randomUUID() },
  ])
    await expect(
      restarted.prepare(scope, module, call, f.live),
    ).rejects.toThrow(/No offline/);
  await expect(
    restarted.prepare(
      f.scope,
      { ...module, description: "Replaced bytes" },
      call,
      f.live,
    ),
  ).rejects.toThrow(/match/);
  await expect(
    restarted.prepare(
      f.scope,
      module,
      { ...call, input: { filename: "../../private", content: "" } },
      f.live,
    ),
  ).rejects.toThrow();
  const copied = { ...f.scope, userId: randomUUID() };
  f.storage.values.set(f.storage.key(copied), await f.storage.load(f.scope));
  await expect(restarted.prepare(copied, module, call, f.live)).rejects.toThrow(
    /another workspace or profile/,
  );
});

it("rechecks live profile access after asynchronous storage and before a delayed device effect", async () => {
  const f = await fixture();
  const handle = await f.prepare();
  f.close();
  await expect(handle.recheck()).rejects.toThrow(/Profile locked/);
  const other = await fixture();
  other.storage.beforeSave = async () => other.close();
  await expect(other.prepare()).rejects.toThrow(/Profile locked/);
});

it("persists connected policy revocation and rejects old policy views and stale renewal responses", async () => {
  const f = await fixture();
  const handle = await f.prepare();
  const old = await f.issue();
  let release!: () => void;
  let fetched!: () => void;
  const started = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const renewal = f.manager.refresh(
    f.scope,
    module,
    "export",
    f.live,
    async () => {
      fetched();
      await wait;
      return old;
    },
  );
  await started;
  await f.manager.observePolicy(f.scope, "4", false);
  release();
  await expect(renewal).rejects.toThrow(/changed during renewal/);
  await expect(handle.recheck()).rejects.toThrow(/disabled/);
  // A delayed observation may not re-enable the same denied revision or replace it with an older one.
  await f.manager.observePolicy(f.scope, "3", true);
  await f.manager.observePolicy(f.scope, "4", true);
  const restarted = new CorporateCapabilityLeases(f.storage, f.clock);
  f.setAccess({ policyRevision: "4" });
  await expect(
    restarted.prepare(f.scope, module, call, f.live),
  ).rejects.toThrow(/disabled/);
  await restarted.observePolicy(f.scope, "5", true);
  await expect(
    restarted.prepare(f.scope, module, call, f.live),
  ).rejects.toThrow(/policy changed/);
  f.setAccess({ policyRevision: "5" });
  await expect(
    restarted.prepare(f.scope, module, call, f.live),
  ).rejects.toThrow(/No offline/);
});

it("invalidates a prepared effect after cross-instance policy changes and after explicit denial", async () => {
  const f = await fixture();
  const handle = await f.prepare();
  const other = new CorporateCapabilityLeases(f.storage, f.clock);
  await other.observePolicy(f.scope, "4", true);
  await expect(handle.recheck()).rejects.toThrow(/policy changed/);
  f.setAccess({ policyRevision: "4" });
  await f.refresh();
  const renewed = await f.prepare();
  await other.invalidate(f.scope);
  await expect(renewed.recheck()).rejects.toThrow(/No offline/);
});

it("bounds access by both the signed expiry and the workspace lease, including slow durable writes", async () => {
  const f = await fixture();
  const handle = await f.prepare();
  f.setClock({ wall: 160000, monotonic: 60000 });
  await expect(handle.recheck()).rejects.toThrow(/expired/);
  const other = await fixture();
  other.setAccess({ expiresAt: 100000 });
  await expect(other.prepare()).rejects.toThrow(
    /Workspace offline access expired/,
  );
  const slow = await fixture();
  slow.storage.beforeSave = async () =>
    slow.setClock({ wall: 160000, monotonic: 60000 });
  await expect(slow.prepare()).rejects.toThrow(/access changed/);
  slow.storage.beforeSave = undefined;
  slow.setClock({ wall: 100001, monotonic: 0 });
  const restarted = new CorporateCapabilityLeases(slow.storage, slow.clock);
  await expect(
    restarted.prepare(slow.scope, module, call, slow.live),
  ).rejects.toThrow(/clock moved backwards/);
});

it("blocks clock rollback across restart and only renews from a newly verified connected grant", async () => {
  const f = await fixture();
  f.setClock({ wall: 120000, monotonic: 20000 });
  await f.prepare();
  f.setClock({ wall: 110000, monotonic: 0 });
  const restarted = new CorporateCapabilityLeases(f.storage, f.clock);
  await expect(
    restarted.prepare(f.scope, module, call, f.live),
  ).rejects.toThrow(/clock moved backwards/);
  f.setClock({ wall: 120001, monotonic: 1 });
  await expect(
    restarted.prepare(f.scope, module, call, f.live),
  ).rejects.toThrow(/clock moved backwards/);
  await restarted.refresh(f.scope, module, "export", f.live, f.issue);
  await expect(
    restarted.prepare(f.scope, module, call, f.live),
  ).resolves.toBeDefined();
});

it("uses monotonic elapsed time so small repeated wall-clock adjustments cannot prolong a lease", async () => {
  const f = await fixture();
  await f.prepare();
  f.setClock({ wall: 100000, monotonic: 60001 });
  await expect(f.prepare()).rejects.toThrow(/expired/);
});

it("rejects invalid trusted responses, replaced signatures and corrupted persistence without discarding it", async () => {
  const f = await fixture();
  const good = await f.issue();
  await expect(
    f.manager.refresh(f.scope, module, "export", f.live, async () => ({
      ...good,
      authority: { ...good.authority, issuer: "https://other.test" },
    })),
  ).rejects.toThrow(/match/);
  const stored = (await f.storage.load(f.scope)) as {
    leases: { signature: string }[];
  };
  stored.leases[0].signature = "A".repeat(86) + "==";
  f.storage.values.set(f.storage.key(f.scope), stored);
  await expect(f.prepare()).rejects.toThrow(/signature/);
  f.storage.values.set(f.storage.key(f.scope), { corrupt: true });
  await expect(f.prepare()).rejects.toThrow();
  expect(await f.storage.load(f.scope)).toEqual({ corrupt: true });
});

it("rotates trusted keys and invalidates an earlier prepared action instead of silently reauthorizing it", async () => {
  const f = await fixture();
  const handle = await f.prepare();
  f.rotate();
  await f.refresh();
  await expect(handle.recheck()).rejects.toThrow(/lease changed/);
  await expect(f.prepare()).resolves.toBeDefined();
});

it("never grants an effect when persistence fails or offline access is disabled by the device owner", async () => {
  const f = await fixture();
  f.storage.beforeSave = async () => {
    throw Error("Disk full");
  };
  await expect(f.prepare()).rejects.toThrow(/Disk full/);
  f.storage.beforeSave = undefined;
  f.setAccess({ offlineEnabled: false });
  await expect(f.prepare()).rejects.toThrow(/disabled/);
});

it("keeps a clock fault detected during the final durable write blocked until connected renewal", async () => {
  const f = await fixture();
  f.storage.beforeSave = async () => f.setClock({ wall: 98000, monotonic: 1 });
  await expect(f.prepare()).rejects.toThrow(/clock moved backwards/);
  f.storage.beforeSave = undefined;
  f.setClock({ wall: 100001, monotonic: 2 });
  await expect(f.prepare()).rejects.toThrow(/clock moved backwards/);
  await f.refresh();
  await expect(f.prepare()).resolves.toBeDefined();
});

it("discards old leases as soon as a rotated API key is observed, even without successful issuance", async () => {
  const f = await fixture();
  const handle = await f.prepare();
  f.rotate();
  const next = await f.issue();
  await f.manager.observeAuthority(f.scope, async () => next.authority, f.live);
  await expect(handle.recheck()).rejects.toThrow(/revoked/);
  const restarted = new CorporateCapabilityLeases(f.storage, f.clock);
  await expect(
    restarted.prepare(f.scope, module, call, f.live),
  ).rejects.toThrow(/No offline/);
  await f.refresh();
  await expect(f.prepare()).resolves.toBeDefined();
});

it("cannot restore an old key from a delayed response after another host observes rotation", async () => {
  const f = await fixture();
  const old = await f.issue();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = f.manager.observeAuthority(
    f.scope,
    async () => {
      started();
      await held;
      return old.authority;
    },
    f.live,
  );
  await ready;
  f.rotate();
  const next = await f.issue();
  const other = new CorporateCapabilityLeases(f.storage, f.clock);
  await other.observeAuthority(f.scope, async () => next.authority, f.live);
  release();
  await expect(pending).rejects.toThrow(/changed while loading/);
  await expect(f.prepare()).rejects.toThrow(/No offline/);
});

it("keeps known server denial effective if its durable invalidation write fails", async () => {
  const f = await fixture();
  f.storage.beforeSave = async () => {
    throw Error("Disk full");
  };
  await expect(f.manager.invalidate(f.scope)).rejects.toThrow(/Disk full/);
  f.storage.beforeSave = undefined;
  await expect(f.prepare()).rejects.toThrow(/revoked/);
  const restarted = new CorporateCapabilityLeases(f.storage, f.clock);
  await expect(
    restarted.prepare(f.scope, module, call, f.live),
  ).rejects.toThrow(/No offline/);
  await f.refresh();
  f.setAccess({ expiresAt: 130000 });
  expect(await f.manager.inspect(f.scope, module, "export", f.live)).toBe(
    130000,
  );
});

it("does not clear a newer denial when an earlier renewal finishes writing", async () => {
  const f = await fixture();
  const response = await f.issue();
  let denial: Promise<void> | undefined;
  const renewal = f.manager.refresh(
    f.scope,
    module,
    "export",
    f.live,
    async () => {
      f.storage.beforeSave = async () => {
        f.storage.beforeSave = async () => {
          throw Error("Disk full");
        };
        denial = f.manager.invalidate(f.scope).catch(() => {});
      };
      return response;
    },
  );
  await expect(renewal).rejects.toThrow(/changed during renewal/);
  await denial;
  f.storage.beforeSave = undefined;
  await expect(f.prepare()).rejects.toThrow(/revoked/);
});
