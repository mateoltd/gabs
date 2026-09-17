import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { Type, type ModuleCall } from "@suite/module-sdk";
import { signPackage } from "../packages/module-sdk/node/signing";
import contacts from "../modules/contacts/module";
import type { Platform, Scope } from "../packages/platform/src";
import { isModuleArtifactKey } from "../packages/platform/src";
import {
  changeModuleStorage,
  enqueue,
  readModuleStorage,
  syncModuleStorage,
} from "../packages/platform/src/module-storage";
import type { StoredModuleState } from "../packages/platform/src/module-artifacts";
import { verifyResponseContract } from "../packages/platform/src/module-response";
const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const publicKey = pair.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const original = signPackage(contacts, privateKey);
const upgraded = signPackage(
  {
    ...contacts,
    version: "2.0.0",
    resources: {
      ...contacts.resources,
      contacts: {
        ...contacts.resources.contacts,
        schema: Type.Object({ name: Type.Number() }),
      },
    },
  },
  privateKey,
);
const other = signPackage(
  {
    ...JSON.parse(JSON.stringify(contacts).replaceAll("contacts", "other")),
    version: "3.0.0",
  },
  privateKey,
);
const scope: Scope = { userId: "user", workspaceId: "company" };
const data = { name: "Retained", kind: "person", relationship: "other" };
const row = {
  id: "record",
  data,
  version: 1,
  archived: false,
  updatedAt: "2026-09-17T00:00:00Z",
};
const call = (
  key: string,
  moduleId = "contacts",
  moduleVersion = "1.1.0",
): ModuleCall => ({
  moduleId,
  moduleVersion,
  resource: moduleId === "other" ? "other" : "contacts",
  action: "create",
  input: { data },
  key,
});
function storage() {
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (key: string, fn: () => Promise<unknown>) => {
        const next = (locks.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(fn);
        locks.set(key, next);
        return next;
      },
    },
  });
  const records = new Map<string, unknown>();
  let failRoot = false;
  const path = (s: Scope, key: string) => `${s.userId}/${s.workspaceId}/${key}`;
  const platform: Platform = {
    kind: "desktop",
    load: async <T>(s: Scope, key: string) =>
      structuredClone(records.get(path(s, key))) as T | undefined,
    save: async (s, key, value) => {
      if (key === "module-state" && failRoot) {
        failRoot = false;
        throw Error("Interrupted commit");
      }
      records.set(path(s, key), structuredClone(value));
    },
    pruneModuleArtifacts: async (s, keep) => {
      const retained = new Set(keep.map((key) => path(s, key)));
      for (const key of records.keys())
        if (key.startsWith(path(s, "module-artifact/")) && !retained.has(key))
          records.delete(key);
    },
    purgeWorkspace: async () => {},
    purgeUser: async () => {},
    identity: async () => undefined,
    rememberIdentity: async () => {},
    saveFile: async () => {},
    notify: async () => {},
  };
  const install = async (pkg = original) =>
    changeModuleStorage(platform, scope, (s) => {
      s.installed[pkg.module_id] = {
        signed: pkg,
        artifact: pkg.artifact,
        publicKey,
        version: pkg.version,
        verifiedAt: 1,
      };
    });
  const root = () =>
    structuredClone(
      records.get(path(scope, "module-state")),
    ) as StoredModuleState;
  return {
    platform,
    records,
    install,
    root,
    interrupt: () => {
      failRoot = true;
    },
  };
}
afterEach(() => vi.unstubAllGlobals());
it("retains original signed versions through updates and uninstall, isolates scopes, and retries uncertain receipts without blocking unrelated work", async () => {
  const { platform, install, root } = storage();
  await install();
  await install(other);
  await enqueue(platform, scope, call("first"));
  await enqueue(platform, scope, call("dependent"), ["first"]);
  await enqueue(platform, scope, call("other", "other", "3.0.0"));
  await install(upgraded);
  await changeModuleStorage(platform, scope, (s) => {
    delete s.installed.other;
    s.journal.push({
      ...s.journal[0],
      userId: "foreign",
      workspaceId: "foreign",
      call: call("foreign"),
    });
  });
  expect(Object.keys(root().responseContractRefs!)).toEqual([
    "contacts@1.1.0",
    "other@3.0.0",
  ]);
  expect(root().responseContracts).toBeUndefined();
  const sent: string[] = [];
  const effects = new Map<string, typeof row>();
  let corrupt = true;
  const send = async (request: ModuleCall) => {
    sent.push(request.key!);
    if (!effects.has(request.key!)) effects.set(request.key!, row);
    return corrupt && request.key === "first"
      ? { ...row, data: { ...data, name: 42 } }
      : effects.get(request.key!);
  };
  await syncModuleStorage(platform, scope, send, () => true);
  let state = await readModuleStorage(platform, scope);
  expect(sent).toEqual(["first", "other"]);
  expect(state.journal[0]).toMatchObject({
    state: "pending",
    attempts: 1,
    call: { key: "first" },
  });
  expect(state.journal[0].result).toBeUndefined();
  expect(state.journal[0].error).toContain("could not be verified");
  expect(state.journal[1]).toMatchObject({ state: "pending", attempts: 0 });
  expect(state.journal[2]).toMatchObject({ state: "accepted", result: row });
  expect(state.journal[3]).toMatchObject({
    userId: "foreign",
    state: "pending",
    attempts: 0,
  });
  await changeModuleStorage(platform, scope, (s) => {
    delete s.installed.contacts;
    s.journal = s.journal.filter((e) => e.userId === scope.userId);
  });
  corrupt = false;
  await syncModuleStorage(platform, scope, send, () => true);
  state = await readModuleStorage(platform, scope);
  expect(sent).toEqual(["first", "other", "first", "dependent"]);
  expect(effects.size).toBe(3);
  expect(state.journal.every((e) => e.state === "accepted" && !e.error)).toBe(
    true,
  );
  expect(root().responseContractRefs).toEqual({});
  expect(state.installed).toEqual({});
});
it("missing or tampered original contracts preserve pending work and do not dispatch, while unrelated entries still synchronize", async () => {
  const { platform, install } = storage();
  await install();
  await install(other);
  await enqueue(platform, scope, call("missing"));
  await enqueue(platform, scope, call("other", "other", "3.0.0"));
  await install(upgraded);
  await changeModuleStorage(platform, scope, (s) => {
    delete s.responseContracts!["contacts@1.1.0"];
  });
  const sent: string[] = [];
  await syncModuleStorage(
    platform,
    scope,
    async (c) => {
      sent.push(c.key!);
      return row;
    },
    () => true,
  );
  expect(sent).toEqual(["other"]);
  let state = await readModuleStorage(platform, scope);
  expect(state.journal[0]).toMatchObject({ state: "pending", attempts: 1 });
  expect(state.journal[0].error).toContain("original signed module version");
  await changeModuleStorage(platform, scope, (s) => {
    s.responseContracts!["contacts@1.1.0"] = {
      signed: {
        ...original,
        artifact: { ...original.artifact, name: "Tampered" },
      },
      publicKey,
    };
  });
  await syncModuleStorage(
    platform,
    scope,
    async () => {
      throw Error("must not dispatch");
    },
    () => true,
  );
  state = await readModuleStorage(platform, scope);
  expect(state.journal[0]).toMatchObject({ state: "pending", attempts: 2 });
  await install();
  await syncModuleStorage(
    platform,
    scope,
    async () => row,
    () => false,
  );
  expect((await readModuleStorage(platform, scope)).journal[0].state).toBe(
    "pending",
  );
  await syncModuleStorage(
    platform,
    scope,
    async () => row,
    () => true,
  );
  expect((await readModuleStorage(platform, scope)).journal[0].state).toBe(
    "accepted",
  );
});
it("atomically retains signed bytes with queued work and recovers missing chunks without losing the journal", async () => {
  const { platform, install, records, root, interrupt } = storage();
  await install();
  await changeModuleStorage(platform, scope, (s) => {
    s.drafts.draft = data;
  });
  interrupt();
  await expect(
    enqueue(platform, scope, call("atomic"), [], { draftKey: "draft" }),
  ).rejects.toThrow("Interrupted commit");
  expect((await readModuleStorage(platform, scope)).journal).toEqual([]);
  expect((await readModuleStorage(platform, scope)).drafts.draft).toEqual(data);
  await enqueue(platform, scope, call("atomic"), [], { draftKey: "draft" });
  await changeModuleStorage(platform, scope, (s) => {
    delete s.installed.contacts;
  });
  const ref = root().responseContractRefs!["contacts@1.1.0"].signedRef;
  records.delete(
    `${scope.userId}/${scope.workspaceId}/module-artifact/${ref.digest}/0`,
  );
  await syncModuleStorage(
    platform,
    scope,
    async () => {
      throw Error("must not dispatch");
    },
    () => true,
  );
  expect((await readModuleStorage(platform, scope)).journal[0]).toMatchObject({
    state: "pending",
    attempts: 1,
  });
  await install();
  await syncModuleStorage(
    platform,
    scope,
    async () => row,
    () => true,
  );
  await changeModuleStorage(platform, scope, (s) => {
    delete s.installed.contacts;
  });
  await changeModuleStorage(platform, scope, () => {});
  expect(
    [...records.keys()].some((k) =>
      isModuleArtifactKey(k.split(`${scope.workspaceId}/`)[1]),
    ),
  ).toBe(false);
  expect((await readModuleStorage(platform, scope)).journal[0].result).toEqual(
    row,
  );
});
it("rejects unversioned or mismatched resource requests before enqueue without discarding the draft", async () => {
  const { platform, install } = storage();
  await install();
  await changeModuleStorage(platform, scope, (s) => {
    s.drafts.draft = data;
  });
  for (const request of [
    { ...call("bad"), moduleVersion: undefined },
    call("bad", "contacts", "2.0.0"),
    { ...call("bad"), resource: "missing" },
  ]) {
    await expect(
      enqueue(platform, scope, request, [], { draftKey: "draft" }),
    ).rejects.toThrow("original signed module version");
  }
  await expect(
    verifyResponseContract({ signed: original, publicKey }, call("valid")),
  ).resolves.toMatchObject({ id: "contacts", version: "1.1.0" });
  expect((await readModuleStorage(platform, scope)).drafts.draft).toEqual(data);
  expect((await readModuleStorage(platform, scope)).journal).toEqual([]);
});
