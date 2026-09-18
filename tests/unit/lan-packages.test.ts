import { expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { defineModule, Type } from "@suite/module-sdk";
import { signPackage } from "@suite/module-sdk/node/signing";
import {
  artifactRelays,
  decodeArtifactPart,
  relayArtifactLimit,
} from "@suite/module-sdk/relay-artifacts";
import type {
  ArtifactMetadata,
  SignedArtifact,
} from "@suite/module-sdk/platform";
import type { OperationRequest } from "../../packages/contracts/src";
import { LanPackages } from "../../apps/desktop/src/main/lan/packages";
import { verifyLanPackage } from "../../apps/desktop/src/utility/lan-package";
import {
  validateRelayEnvelope,
  type RelayEnvelope,
} from "../../apps/desktop/src/main/lan/transport";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
function signed(version = "1.0.0") {
  return signPackage(
    defineModule({
      id: "transfer-notes",
      name: "Transfer notes",
      description: "á".repeat(100000),
      version,
      publisher: "suite",
      host: "^1",
      backend: "^1",
      dependencies: {},
      permissions: [],
      configuration: Type.Object({}),
      resources: {},
      operations: {},
    }),
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
}
function fixture() {
  const pkg = signed(),
    scope = { userId: randomUUID(), workspaceId: randomUUID() };
  const selection = {
    moduleId: pkg.module_id,
    version: pkg.version,
    digest: pkg.digest,
  };
  const storage = new Map<string, unknown>(),
    inbox: RelayEnvelope[] = [];
  let user: string | undefined = scope.userId,
    status = 200,
    metadata: ArtifactMetadata = (({ artifact: _, ...header }) => header)(pkg);
  let afterVerify: (() => void) | undefined;
  const sent: OperationRequest[] = [];
  const key = (s: typeof scope, name: string) =>
    `${s.userId}/${s.workspaceId}/${name}`;
  const host = {
    currentUser: () => user,
    request: async (request: OperationRequest) => {
      sent.push(request);
      return request.operation === "moduleTrust"
        ? { status: 200, body: { publicKey } }
        : { status, body: metadata };
    },
    read: async (s: typeof scope, name: string) =>
      structuredClone(storage.get(key(s, name))),
    write: async (s: typeof scope, name: string, value: unknown) => {
      storage.set(key(s, name), structuredClone(value));
    },
    prune: async (s: typeof scope, keep: string[]) => {
      for (const k of storage.keys())
        if (k.startsWith(key(s, "")) && !keep.map((n) => key(s, n)).includes(k))
          storage.delete(k);
    },
    verify: async (
      s: typeof scope,
      transfer: Parameters<typeof verifyLanPackage>[1],
      header: ArtifactMetadata,
      trust: string,
    ) => {
      const result = await verifyLanPackage(
        (index) => storage.get(key(s, `${transfer.transfer}/${index}`)),
        transfer,
        header,
        trust,
      );
      afterVerify?.();
      return result;
    },
    readInbox: async () => structuredClone(inbox),
    dismiss: async (_s: typeof scope, id: string) => {
      inbox.splice(
        inbox.findIndex((e) => e.id === id),
        1,
      );
    },
  };
  let manager = new LanPackages(host);
  const envelope = (
    payload: string,
    id: string = randomUUID(),
  ): RelayEnvelope => ({
    id,
    workspaceId: scope.workspaceId,
    kind: "artifact",
    payload,
    digest: createHash("sha256").update(payload).digest("hex"),
  });
  const frames = async (p: SignedArtifact = pkg) => {
    const result: RelayEnvelope[] = [];
    for await (const frame of artifactRelays(p))
      result.push(envelope(frame.payload, frame.id));
    return result;
  };
  const receive = (e: RelayEnvelope) => manager.receive(scope, e, () => {});
  const transfer = async (p?: SignedArtifact) => {
    for (const frame of await frames(p)) await receive(frame);
  };
  return {
    pkg,
    scope,
    selection,
    storage,
    sent,
    inbox,
    frames,
    envelope,
    receive,
    transfer,
    get manager() {
      return manager;
    },
    restart() {
      manager = new LanPackages(host);
    },
    setStatus: (s: number) => {
      status = s;
    },
    setMetadata: (m: ArtifactMetadata) => {
      metadata = m;
    },
    afterVerify: (fn: () => void) => {
      afterVerify = fn;
    },
    logout() {
      user = undefined;
      manager.invalidate();
    },
  };
}
it("splits Unicode package bytes into stable valid bounded frames and rejects malformed chunks", async () => {
  const f = fixture(),
    frames = await f.frames();
  expect(frames.length).toBeGreaterThan(3);
  expect(await f.frames()).toEqual(frames);
  for (const frame of frames) {
    validateRelayEnvelope(frame, f.scope.workspaceId);
    expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(262144);
    const value = JSON.parse(frame.payload);
    expect(() =>
      decodeArtifactPart({ ...value, content: value.content + "=" }),
    ).toThrow();
    expect(() => decodeArtifactPart({ ...value, parts: 999 })).toThrow();
    expect(() =>
      decodeArtifactPart({ ...value, bytes: relayArtifactLimit + 1 }),
    ).toThrow();
  }
});
it("assembles out of order across restart, repairs missing chunks, and only retires after acknowledgement", async () => {
  const f = fixture(),
    frames = await f.frames();
  await f.receive(frames.at(-1)!);
  expect(await f.manager.get(f.scope, f.selection)).toBeUndefined();
  f.restart();
  for (const frame of frames.slice(0, -1).reverse()) await f.receive(frame);
  const part = JSON.parse(frames[0].payload);
  f.storage.delete(
    `${f.scope.userId}/${f.scope.workspaceId}/${part.transfer}/0`,
  );
  await f.receive(frames[0]);
  await f.receive(frames[0]);
  const received = await f.manager.get(f.scope, f.selection);
  expect(received?.pkg).toEqual(f.pkg);
  expect(f.sent.map((r) => r.operation)).toEqual([
    "moduleArtifactMetadata",
    "moduleTrust",
    "moduleArtifactMetadata",
  ]);
  f.restart();
  expect((await f.manager.get(f.scope, f.selection))?.pkg).toEqual(f.pkg);
  await f.manager.acknowledge(f.scope, received!.transferId);
  expect(await f.manager.get(f.scope, f.selection)).toBeUndefined();
  expect([...f.storage.keys()]).toEqual([
    `${f.scope.userId}/${f.scope.workspaceId}/index`,
  ]);
});
it("rejects collisions and isolates workspace/account caches and stale verification", async () => {
  const f = fixture(),
    frames = await f.frames();
  await f.receive(frames[0]);
  const part = JSON.parse(frames[0].payload);
  part.content = Buffer.alloc(65536, 7).toString("base64");
  await expect(f.receive(f.envelope(JSON.stringify(part)))).rejects.toThrow(
    "content changed",
  );
  await f.transfer();
  expect(
    await f.manager.get({ ...f.scope, workspaceId: randomUUID() }, f.selection),
  ).toBeUndefined();
  expect(() =>
    f.manager.get({ ...f.scope, userId: randomUUID() }, f.selection),
  ).toThrow("profile");
  f.afterVerify(() => f.logout());
  await expect(f.manager.get(f.scope, f.selection)).rejects.toThrow("profile");
});
it("rechecks current access and exact pins after heavy verification", async () => {
  const f = fixture();
  await f.transfer();
  f.setStatus(403);
  await expect(f.manager.get(f.scope, f.selection)).rejects.toThrow("access");
  f.setStatus(200);
  f.setMetadata({ ...f.pkg, version: "2.0.0" });
  await expect(f.manager.get(f.scope, f.selection)).rejects.toThrow();
  const { artifact: _, ...metadata } = f.pkg;
  f.setMetadata(metadata);
  f.afterVerify(() => f.setStatus(403));
  await expect(f.manager.get(f.scope, f.selection)).rejects.toThrow("access");
  f.setStatus(200);
  f.afterVerify(() => f.setMetadata({ ...metadata, version: "2.0.0" }));
  await expect(f.manager.get(f.scope, f.selection)).rejects.toThrow(
    "release changed",
  );
});
it("never returns corrupt aggregate bytes or invalid signatures and preserves pending work", async () => {
  for (const tamper of ["aggregate", "signature"] as const) {
    const f = fixture();
    f.inbox.push({ ...f.envelope("draft"), kind: "pending" });
    if (tamper === "signature")
      await f.transfer({
        ...f.pkg,
        signature: Buffer.alloc(64).toString("base64"),
      });
    else {
      await f.transfer();
      const frame = (await f.frames())[0],
        part = JSON.parse(frame.payload);
      f.storage.set(
        `${f.scope.userId}/${f.scope.workspaceId}/${part.transfer}/0`,
        Buffer.alloc(65536, 7).toString("base64"),
      );
    }
    expect(await f.manager.get(f.scope, f.selection)).toBeUndefined();
    expect(f.inbox).toHaveLength(1);
    expect(f.inbox[0].kind).toBe("pending");
    expect([...f.storage.keys()]).toHaveLength(1);
    await f.transfer();
    expect((await f.manager.get(f.scope, f.selection))?.pkg).toEqual(f.pkg);
  }
});
it("bounds reconstructable transfers, prunes crash orphans, and keeps durable partial transfers", async () => {
  const f = fixture();
  f.storage.set(`${f.scope.userId}/${f.scope.workspaceId}/orphan/0`, "orphan");
  for (let index = 0; index < 5; index++)
    await f.receive((await f.frames(signed(`1.0.${index}`)))[0]);
  const prefix = `${f.scope.userId}/${f.scope.workspaceId}/`;
  expect(f.storage.has(prefix + "orphan/0")).toBe(false);
  expect(f.storage.get(prefix + "index")).toHaveLength(4);
  expect(f.storage.size).toBe(5);
  f.restart();
  expect(await f.manager.get(f.scope, f.selection)).toBeUndefined();
});
it("verifies old whole-package quarantine receipts and removes only the exact acknowledged package", async () => {
  const f = fixture();
  const small = { ...f.pkg };
  // Whitespace-free canonical serialization is not required: original bytes are bound to the transfer.
  const m = defineModule({
    id: "transfer-notes",
    name: "Small",
    description: "Small legacy package",
    version: "1.0.0",
    publisher: "suite",
    host: "^1",
    backend: "^1",
    dependencies: {},
    permissions: [],
    configuration: Type.Object({}),
    resources: {},
    operations: {},
  });
  Object.assign(
    small,
    signPackage(
      m,
      keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ),
  );
  const { artifact: _, ...metadata } = small;
  f.setMetadata(metadata);
  const legacy = f.envelope(JSON.stringify(small));
  f.inbox.push(legacy, { ...f.envelope("draft"), kind: "pending" });
  const received = await f.manager.get(f.scope, {
    ...f.selection,
    digest: small.digest,
  });
  expect(received?.pkg).toEqual(small);
  expect(f.inbox).toHaveLength(2);
  await f.manager.acknowledge(f.scope, received!.transferId);
  expect(f.inbox.map((e) => e.kind)).toEqual(["pending"]);
});

it("repairs a damaged optional index and enforces the aggregate byte budget independently of count", async () => {
  const f = fixture(),
    prefix = `${f.scope.userId}/${f.scope.workspaceId}/`;
  f.inbox.push({ ...f.envelope("draft"), kind: "pending" });
  f.storage.set(prefix + "index", { invalid: true });
  f.storage.set(prefix + "orphan/0", "left by interruption");
  expect(await f.manager.get(f.scope, f.selection)).toBeUndefined();
  expect([...f.storage.keys()]).toEqual([prefix + "index"]);
  expect(f.inbox).toHaveLength(1);
  await f.transfer();
  expect((await f.manager.get(f.scope, f.selection))?.pkg).toEqual(f.pkg);
  const first = JSON.parse((await f.frames())[0].payload);
  const large = {
    ...first,
    transfer: "a".repeat(64),
    bytes: relayArtifactLimit,
    parts: 1024,
  };
  await f.receive(f.envelope(JSON.stringify(large)));
  expect(f.storage.get(prefix + "index")).toHaveLength(1);
  expect([...f.storage.keys()]).toEqual([
    prefix + "index",
    prefix + large.transfer + "/0",
  ]);
  await f.receive((await f.frames())[0]);
  expect(f.storage.get(prefix + "index")).toHaveLength(1);
  expect(f.storage.has(prefix + large.transfer + "/0")).toBe(false);
  expect(f.inbox).toHaveLength(1);
});
