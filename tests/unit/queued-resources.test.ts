import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  createModuleClient,
  defineModule,
  resource,
  field,
  isQueueCaptureError,
  type QueuedResource,
} from "@suite/module-sdk";
import module from "../fixtures/queued-resources/module";
import { createModuleQueue } from "../../packages/client/src/modules/queued";
import {
  changeModuleStorage,
  readModuleStorage,
  syncModuleStorage,
} from "../../packages/client/src/modules/storage";
import type { Platform } from "../../packages/client/src";
import { signPackage } from "../../packages/sdk/node/signing";
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import server from "../fixtures/queued-resources/module-server";
const scope = { userId: "user", workspaceId: "workspace" };
const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (key: string, run: () => Promise<unknown>) => {
        const next = (locks.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(run);
        locks.set(key, next);
        return next;
      },
    },
  });
  const records = new Map<string, unknown>();
  let afterSave = () => {};
  const platform = {
    load: async (s: typeof scope, key: string) =>
      structuredClone(records.get(JSON.stringify([s, key]))),
    save: async (s: typeof scope, key: string, value: unknown) => {
      records.set(JSON.stringify([s, key]), structuredClone(value));
      if (key === "module-state") afterSave();
    },
    pruneModuleArtifacts: async () => {},
  } as unknown as Platform;
  const pkg = signPackage(
    { ...module, views: undefined, navigation: undefined },
    privateKey,
  );
  await changeModuleStorage(platform, scope, (state) => {
    state.installed[module.id] = {
      version: module.version,
      signed: pkg,
      publicKey,
      artifact: pkg.artifact,
      verifiedAt: Date.now(),
    };
  });
  let allowed = true;
  const send = vi.fn(async () => {
    throw Error("Direct transport must not execute queued capture.");
  });
  const client = () =>
    createModuleClient(
      module,
      send,
      createModuleQueue(platform, scope, () => allowed),
    );
  return {
    platform,
    afterSave: (run: () => void) => {
      afterSave = run;
    },
    client,
    send,
    deny: () => {
      allowed = false;
    },
    read: () => readModuleStorage(platform, scope),
  };
}
it("captures typed resource writes with command prerequisites and stable retry targets through restart", async () => {
  const f = await fixture();
  const parent = await f.client().queue("capture", { name: "Parent" });
  const receipt = await f
    .client()
    .resource("notes")
    .queue.create(
      { name: "Child" },
      { key: "resource-key-001", dependencies: [parent.key] },
    );
  expect(receipt).toMatchObject({
    state: "pending",
    delivery: "unsubmitted",
    input: { data: { name: "Child" } },
    dependencies: [parent.key],
  });
  expect(receipt).not.toHaveProperty("value");
  expect(f.send).not.toHaveBeenCalled();
  expect(
    await f.client().resource("notes").queue.get("create", receipt.key),
  ).toEqual(receipt);
  expect(
    await f
      .client()
      .resource("notes")
      .queue.create(
        { name: "Child" },
        { key: receipt.key, dependencies: [parent.key] },
      ),
  ).toEqual(receipt);
  await expect(
    f
      .client()
      .resource("notes")
      .queue.create(
        { name: "Changed" },
        { key: receipt.key, dependencies: [parent.key] },
      ),
  ).rejects.toThrow(/different content/);
  await expect(
    f
      .client()
      .resource("notes")
      .queue.create({ name: "Child" }, { key: receipt.key, dependencies: [] }),
  ).rejects.toThrow(/prerequisites/);
  expect((await f.read()).journal).toHaveLength(2);
  const sent: string[] = [];
  await syncModuleStorage(
    f.platform,
    scope,
    async (call) => {
      sent.push(call.key!);
      if (call.action === "operation") return { id: crypto.randomUUID() };
      const input = call.input as typeof receipt.input;
      return {
        id: input.id,
        data: input.data,
        version: 1,
        archived: false,
        updatedAt: new Date().toISOString(),
      };
    },
    () => true,
  );
  expect(sent).toEqual([parent.key, receipt.key]);
  const accepted = await f
    .client()
    .resource("notes")
    .queue.get("create", receipt.key);
  expect(accepted?.state).toBe("accepted");
  if (accepted?.state !== "accepted") throw Error("Acceptance required");
  expect(accepted.value.id).toBe(receipt.input.id);
  await changeModuleStorage(f.platform, scope, (state) => {
    const replacement = structuredClone(state.journal[0]);
    replacement.id = crypto.randomUUID();
    replacement.call.key = replacement.id;
    state.journal.push(replacement);
    state.journal.find((entry) => entry.id === receipt.key)!.dependencies = [
      replacement.id,
    ];
  });
  const retried = await f
    .client()
    .resource("notes")
    .queue.create(
      { name: "Child" },
      { key: receipt.key, dependencies: [parent.key] },
    );
  expect(retried.state).toBe("accepted");
  expect(retried.input).toEqual(receipt.input);
  expect(retried.dependencies).not.toEqual(receipt.dependencies);

  if (false) {
    // @ts-expect-error Pending results do not expose confirmed resource data.
    receipt.value;
    // @ts-expect-error Resource field types are inferred.
    await f.client().resource("notes").queue.create({ name: 23 });
    // @ts-expect-error Unknown resource identifiers are rejected.
    f.client().resource("unknown");
  }
});
it("preserves update bases and archive targets with dependencies, and denies revoked receipt access", async () => {
  const f = await fixture();
  const id = crypto.randomUUID();
  const base = {
    id,
    data: { name: "Original" },
    version: 4,
    archived: false,
    updatedAt: new Date().toISOString(),
  };
  const queue = f.client().resource("notes").queue;
  const update = await queue.update(id, { name: "Changed" }, base);
  const archive = await queue.archive(id, 5, { dependencies: [update.key] });
  expect(update.input).toEqual({
    id,
    data: { name: "Changed" },
    baseVersion: 4,
    baseData: base.data,
  });
  expect(archive.input).toEqual({ id, baseVersion: 5 });
  expect(archive.dependencies).toEqual([update.key]);
  expect(() =>
    queue.update(crypto.randomUUID(), { name: "Wrong" }, base),
  ).toThrow(/another target/);
  const sent: string[] = [];
  await syncModuleStorage(
    f.platform,
    scope,
    async (call) => {
      sent.push(call.key!);
      return {
        ...base,
        data: { name: "Changed" },
        version: call.action === "update" ? 5 : 6,
        archived: call.action === "archive",
      };
    },
    () => true,
  );
  expect(sent).toEqual([update.key, archive.key]);
  expect(await queue.get("update", update.key)).toMatchObject({
    state: "accepted",
    value: { version: 5, data: { name: "Changed" } },
  });
  expect(await queue.get("archive", archive.key)).toMatchObject({
    state: "accepted",
    value: { version: 6, archived: true },
  });
  f.deny();
  await expect(queue.get("update", update.key)).rejects.toThrow(/access/);
  await expect(queue.archive(id, 5)).rejects.toThrow(/access/);
  expect((await f.read()).journal).toHaveLength(2);
});
it("reports resource identity on uncertain local capture and rejects incompatible policies and malformed receipts", async () => {
  const online = defineModule({
    ...module,
    resources: {
      notes: resource(
        { name: field.text() },
        { title: "Notes", policy: "online" },
      ),
    },
  });
  const c = createModuleClient(online, async () => undefined);
  if (false) {
    // @ts-expect-error Online resources do not expose queued authoring.
    c.resource("notes").queue.create({ name: "No" });
  }
  const client = createModuleClient(module, async () => undefined, {
    capture: async () => undefined,
    get: async () => undefined,
    resources: {
      get: async () => undefined,
      capture: async () => ({ state: "accepted", value: { id: "fake" } }),
    },
  });
  try {
    await client
      .resource("notes")
      .queue.create({ name: "Retain" }, { key: "stable-resource-key" });
    throw Error("Expected rejection");
  } catch (error) {
    expect(isQueueCaptureError(error)).toBe(true);
    if (isQueueCaptureError(error))
      expect(error.identity).toMatchObject({
        resource: "notes",
        action: "create",
        key: "stable-resource-key",
      });
  }
});
it("simulates public queued resources and rechecks current permissions before synchronization", async () => {
  const sim = createModuleSimulator(module, { server });
  sim.setOnline(false);
  const queue = sim.client.resource("notes").queue;
  const receipt = await queue.create({ name: "Simulated" });
  expect(receipt.state).toBe("pending");
  sim.setPermissions(["custom-notes.notes.read"]);
  sim.setOnline(true);
  await sim.sync();
  expect(sim.snapshot().journal[0].state).toBe("rejected");
  await expect(queue.get("create", receipt.key)).rejects.toThrow(/permission/);
});

it("narrows resource receipts by action as well as acceptance state", () => {
  const inspect = (receipt: QueuedResource<{ name: string }>) => {
    if (receipt.action === "archive") {
      // @ts-expect-error Archive capture has no fabricated data snapshot.
      receipt.input.data;
      return receipt.input.baseVersion;
    }
    const name: string = receipt.input.data.name;
    if (receipt.action === "update") {
      const original: string = receipt.input.baseData.name;
      return original;
    }
    return name;
  };
  expect(
    inspect({
      moduleId: "notes",
      moduleVersion: "1",
      resource: "notes",
      action: "archive",
      key: "key",
      input: { id: crypto.randomUUID(), baseVersion: 3 },
      dependencies: [],
      state: "pending",
      delivery: "unsubmitted",
    }),
  ).toBe(3);
});

it("retains a committed capture identity when authority changes before acknowledgment", async () => {
  const f = await fixture();
  f.afterSave(f.deny);
  const pending = f
    .client()
    .resource("notes")
    .queue.create({ name: "Preserved" }, { key: "capture-with-revocation" });
  await expect(pending).rejects.toMatchObject({
    code: "QUEUED_CAPTURE_UNCONFIRMED",
    identity: {
      resource: "notes",
      action: "create",
      key: "capture-with-revocation",
    },
  });
  expect((await f.read()).journal).toMatchObject([
    {
      id: "capture-with-revocation",
      state: "pending",
      delivery: "unsubmitted",
      call: { input: { data: { name: "Preserved" } } },
    },
  ]);
});
it("rejects malformed direct host capture and isolates queued resource receipts by workspace", async () => {
  const f = await fixture();
  const provider = createModuleQueue(f.platform, scope, () => true);
  await expect(
    provider.resources!.capture(
      {
        moduleId: module.id,
        moduleVersion: module.version,
        resource: "notes",
        action: "create",
        key: "invalid-input-key",
        input: { id: crypto.randomUUID(), data: { name: 4 } },
      },
      [],
    ),
  ).rejects.toThrow();
  expect((await f.read()).journal).toHaveLength(0);
  const receipt = await f
    .client()
    .resource("notes")
    .queue.create({ name: "Isolated" });
  const other = createModuleClient(
    module,
    f.send,
    createModuleQueue(
      f.platform,
      { ...scope, workspaceId: "another-workspace" },
      () => true,
    ),
  );
  expect(
    await other.resource("notes").queue.get("create", receipt.key),
  ).toBeUndefined();
});

it("does not narrow malformed resource capture errors into valid retry identities", () => {
  expect(
    isQueueCaptureError({
      code: "QUEUED_CAPTURE_UNCONFIRMED",
      message: "Failure",
      identity: {
        moduleId: "notes",
        moduleVersion: "1",
        resource: "notes",
        key: "retained-key",
        operation: 42,
        action: "delete-all",
      },
    }),
  ).toBe(false);
});
