import { it, expect, vi } from "vitest";
import type { Platform, Scope } from "../../packages/client/src";
import { isModuleArtifactKey } from "../../packages/client/src";
import {
  changeModuleStorage,
  readModuleStorage,
  type ModuleStorage,
} from "../../packages/client/src/modules/storage";
import type { SignedArtifact } from "@suite/module-sdk/platform";

it("stores a growing executable catalog in bounded records and recovers atomic updates, legacy data and orphaned bytes", async () => {
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
  const scope: Scope = { userId: "user", workspaceId: "company" };
  const path = (s: Scope, key: string) => `${s.userId}/${s.workspaceId}/${key}`;
  let failRoot = false,
    failChunk = false;
  const platform: Platform = {
    accountRevision: async () => "initial",
    kind: "desktop",
    load: async <T>(s: Scope, key: string) =>
      structuredClone(records.get(path(s, key))) as T | undefined,
    save: async (s, key, value) => {
      if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024)
        throw Error("Record too large");
      if (key === "module-state" && failRoot) {
        failRoot = false;
        throw Error("Interrupted commit");
      }
      if (isModuleArtifactKey(key) && failChunk) {
        failChunk = false;
        throw Error("Interrupted chunk");
      }
      records.set(path(s, key), structuredClone(value));
    },
    pruneModuleArtifacts: async (s, keep) => {
      const retained = new Set(keep.map((k) => path(s, k)));
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
  const pkg = (id: string, version: string): SignedArtifact => ({
    module_id: id,
    version,
    manifest: {},
    digest: "test",
    signature: "test",
    key_id: "test",
    artifact: { code: "x".repeat(900_000) },
  });
  const first = pkg("one", "1.0.0");
  const legacy: ModuleStorage = {
    installed: {
      one: {
        version: first.version,
        artifact: first.artifact,
        signed: first,
        verifiedAt: 1,
      },
    },
    journal: [],
    pages: {},
    drafts: { note: { text: "Keep this work" } },
  };
  await platform.save(scope, "module-state", legacy);
  await changeModuleStorage(platform, scope, (s) => {
    for (const id of ["two", "three", "four"]) {
      const signed = pkg(id, "1.0.0");
      s.installed[id] = {
        version: signed.version,
        artifact: signed.artifact,
        signed,
        verifiedAt: 1,
      };
    }
    s.downloads = { one: first };
  });
  expect(
    JSON.stringify(records.get(path(scope, "module-state"))).length,
  ).toBeLessThan(2500);
  expect(
    (await readModuleStorage(platform, scope)).installed.four.signed,
  ).toEqual(pkg("four", "1.0.0"));
  const before = new Set(records.keys());
  failRoot = true;
  await expect(
    changeModuleStorage(platform, scope, (s) => {
      s.installed.one.signed = pkg("one", "2.0.0");
      s.installed.one.version = "2.0.0";
    }),
  ).rejects.toThrow("Interrupted commit");
  expect((await readModuleStorage(platform, scope)).installed.one.version).toBe(
    "1.0.0",
  );
  expect(records.size).toBeGreaterThan(before.size);
  await changeModuleStorage(platform, scope, () => {});
  expect(new Set(records.keys())).toEqual(before);
  failChunk = true;
  await expect(
    changeModuleStorage(platform, scope, (s) => {
      s.installed.one.signed = pkg("one", "3.0.0");
    }),
  ).rejects.toThrow("Interrupted chunk");
  expect(
    (await readModuleStorage(platform, scope)).installed.one.signed!.version,
  ).toBe("1.0.0");
  // An interrupted/corrupt package does not destroy unrelated user work or other installations.
  const stored = records.get(path(scope, "module-state")) as {
    installed: { one: { signedRef: { digest: string } } };
  };
  records.delete(
    path(scope, `module-artifact/${stored.installed.one.signedRef.digest}/0`),
  );
  const damaged = await readModuleStorage(platform, scope);
  expect(damaged.installed.one.signed).toBeUndefined();
  expect(damaged.downloads?.one).toBeUndefined();
  expect(damaged.drafts.note.text).toBe("Keep this work");
  expect(damaged.installed.two.signed).toEqual(pkg("two", "1.0.0"));
  expect(
    (await readModuleStorage(platform, { ...scope, workspaceId: "another" }))
      .installed,
  ).toEqual({});
  await changeModuleStorage(platform, scope, (s) => {
    s.installed.one.signed = first;
  });
  expect(
    (await readModuleStorage(platform, scope)).installed.one.signed,
  ).toEqual(first);
  vi.unstubAllGlobals();
});
