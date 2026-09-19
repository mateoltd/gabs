import { afterEach, expect, it, vi } from "vitest";
import type { Bootstrap } from "../../packages/contracts/src";
import type { Platform, Scope, Snapshot } from "../../packages/client/src";
import { moduleCatalog } from "@suite/module-catalog";
import { WorkspacePolicy } from "../../packages/shell/src/features/administration/policy";
const scope = { userId: "owner", workspaceId: "company" };
const policy: Bootstrap = {
  workspace: {
    id: scope.workspaceId,
    name: "Policy",
    kind: "company",
    currency: "EUR",
    accent: "forest",
    logoDataUrl: "",
  },
  permissions: [],
  roleNames: [],
  modules: [],
  offlineHours: 24,
  seatLimit: 5,
  memberCount: 1,
  authorizedAt: "2026-09-19T12:00:00.000Z",
  policyRevision: "1",
};
const snapshot: Snapshot = {
  bootstrap: policy,
  cachedAt: Date.parse(policy.authorizedAt),
  expiresAt: Date.parse(policy.authorizedAt) + 86400000,
  products: [],
  orders: [],
};
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const disk = new Map<string, unknown>();
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
  const platform = {
    accountRevision: async () => "initial",
    load: async (s: Scope, key: string) =>
      structuredClone(disk.get(JSON.stringify([s, key]))),
    save: async (s: Scope, key: string, value: unknown) => {
      disk.set(JSON.stringify([s, key]), structuredClone(value));
    },
  } as unknown as Platform;
  return {
    platform,
    session: (s = scope) => new WorkspacePolicy(platform, s, moduleCatalog),
  };
}
async function authorize(session: WorkspacePolicy, candidate = policy) {
  return session.accept(candidate, await session.begin());
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it("keeps session-only authority and fresh online policy from opting into storage", async () => {
  const f = fixture(),
    session = f.session();
  const save = vi
    .spyOn(f.platform, "save")
    .mockRejectedValue(Error("Protected storage unavailable"));
  await authorize(session);
  expect(await session.load()).toBeUndefined();
  expect(save).not.toHaveBeenCalled();
});
it("fences old replies and stale writers across denial, restart and reauthentication without losing work", async () => {
  const f = fixture(),
    first = f.session(),
    other = f.session();
  await authorize(first);
  await authorize(other);
  await first.save(snapshot);
  await f.platform.save(scope, "drafts", [{ input: "retained" }]);
  const delayed = await other.begin();
  await first.revoke();
  expect((await f.session().load())?.expiresAt).toBe(0);
  await expect(other.accept(policy, delayed)).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(other.save(snapshot)).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(first.accept(policy)).rejects.toMatchObject({
    name: "AbortError",
  });
  const recovered = f.session();
  const next = { ...policy, policyRevision: "2", offlineHours: 1 };
  await authorize(recovered, next);
  expect((await recovered.load())?.expiresAt).toBe(
    Date.parse(policy.authorizedAt) + 3600000,
  );
  expect(await f.platform.load(scope, "drafts")).toEqual([
    { input: "retained" },
  ]);
  await expect(
    other.accept(
      { ...policy, authorizedAt: "2026-09-19T14:00:00.000Z" },
      delayed,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(
    await f.session({ ...scope, userId: "another" }).load(),
  ).toBeUndefined();
  await expect(
    authorize(f.session({ ...scope, workspaceId: "another" })),
  ).rejects.toThrow("different workspace");
});
it("expires an in-flight first write and denies queued stale saves after received revocation", async () => {
  const f = fixture(),
    session = f.session();
  await authorize(session);
  const held = gate(),
    started = gate();
  const save = f.platform.save.bind(f.platform);
  vi.spyOn(f.platform, "save").mockImplementationOnce(async (...args) => {
    started.release();
    await held.promise;
    return save(...args);
  });
  const write = session.save(snapshot);
  const rejected = expect(write).rejects.toMatchObject({ name: "AbortError" });
  await started.promise;
  const revoke = session.revoke();
  held.release();
  await rejected;
  await revoke;
  expect((await f.session().load())?.expiresAt).toBe(0);
});
it("honors a persisted denial even if interruption prevented expiring the snapshot", async () => {
  const f = fixture(),
    session = f.session();
  await authorize(session);
  await session.save(snapshot);
  const save = f.platform.save.bind(f.platform);
  vi.spyOn(f.platform, "save").mockImplementation(async (s, key, value) => {
    if (key === "snapshot") throw Error("Interrupted snapshot write");
    return save(s, key, value);
  });
  await expect(session.revoke()).rejects.toThrow("Interrupted");
  const restarted = f.session();
  expect((await restarted.load())?.expiresAt).toBe(0);
  expect(restarted.denied).toBe(true);
});
it("reconciles shortened and disabled leases without restoring older persisted policy", async () => {
  const f = fixture(),
    first = f.session(),
    other = f.session();
  await authorize(first);
  await authorize(other);
  await first.save(snapshot);
  const disabled = { ...policy, offlineHours: 0, policyRevision: "2" };
  await authorize(first, disabled);
  expect((await other.save(snapshot)).bootstrap).toEqual(disabled);
  await authorize(first, { ...disabled, offlineHours: 1, policyRevision: "3" });
  expect((await first.load())?.expiresAt).toBe(
    Date.parse(policy.authorizedAt) + 3600000,
  );
});

it("broadcasts denial only to the same account and workspace", async () => {
  const f = fixture(),
    first = f.session(),
    second = f.session();
  const foreign = f.session({ ...scope, userId: "another" });
  await authorize(first);
  await authorize(second);
  const stopFirst = first.subscribe(() => {});
  const stopForeign = foreign.subscribe(() => {
    throw Error("Foreign scope received denial");
  });
  let stopSecond = () => {};
  const received = new Promise<void>((resolve) => {
    stopSecond = second.subscribe(resolve);
  });
  try {
    await first.revoke();
    await received;
    expect(second.denied).toBe(true);
    expect(foreign.denied).toBe(false);
    await expect(second.save(snapshot)).rejects.toMatchObject({
      name: "AbortError",
    });
  } finally {
    stopFirst();
    stopSecond();
    stopForeign();
  }
});
it("refuses a stored snapshot from another workspace", async () => {
  const f = fixture();
  await f.platform.save(
    { ...scope, workspaceId: "another" },
    "snapshot",
    snapshot,
  );
  await expect(
    f.session({ ...scope, workspaceId: "another" }).load(),
  ).rejects.toThrow("different workspace");
});

it("binds request tickets to their account and workspace even before first persistence", async () => {
  const f = fixture(),
    session = f.session();
  const foreignAccount = await f
    .session({ ...scope, userId: "another" })
    .begin();
  const foreignWorkspace = await f
    .session({ ...scope, workspaceId: "another" })
    .begin();
  for (const request of [foreignAccount, foreignWorkspace])
    await expect(session.accept(policy, request)).rejects.toMatchObject({
      name: "AbortError",
    });
  expect(await session.load()).toBeUndefined();
});

it("an account revision expires every workspace lease and fences old requests without deleting work", async () => {
  const f = fixture(),
    session = f.session();
  let revision = "initial";
  f.platform.accountRevision = async (userId) =>
    userId === scope.userId ? revision : "initial";
  const otherWorkspace = { ...scope, workspaceId: "second" };
  const otherPolicy = {
    ...policy,
    workspace: { ...policy.workspace, id: "second" },
  };
  const second = f.session(otherWorkspace);
  await authorize(second, otherPolicy);
  await second.save({ ...snapshot, bootstrap: otherPolicy });
  const foreignScope = { ...scope, userId: "another" };
  const foreign = f.session(foreignScope);
  await authorize(foreign);
  await foreign.save(snapshot);
  await authorize(session);
  await session.save(snapshot);
  const request = await session.begin();
  await f.platform.save(scope, "drafts", [{ input: "Account work" }]);
  revision = crypto.randomUUID();
  expect((await f.session().load())?.expiresAt).toBe(0);
  expect((await f.session(otherWorkspace).load())?.expiresAt).toBe(0);
  expect((await f.session(foreignScope).load())?.expiresAt).toBe(
    snapshot.expiresAt,
  );
  await expect(session.accept(policy, request)).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(session.save(snapshot)).rejects.toMatchObject({
    name: "AbortError",
  });
  const recovered = f.session();
  await authorize(recovered);
  expect((await recovered.load())?.accountRevision).toBe(revision);
  expect(await f.platform.load(scope, "drafts")).toEqual([
    { input: "Account work" },
  ]);
});
