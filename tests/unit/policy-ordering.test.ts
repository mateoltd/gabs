import { it, expect } from "vitest";
import type { Bootstrap } from "../../packages/contracts/src";
import {
  newerPolicy,
  snapshotWithPolicy,
} from "../../packages/shell/src/features/administration/policy-delivery";
import { moduleCatalog } from "@suite/module-catalog";

it("does not restore older permission or lease snapshots after a newer policy arrives", () => {
  const before: Bootstrap = {
    workspace: {
      id: crypto.randomUUID(),
      name: "Policy",
      kind: "company",
      currency: "EUR",
      accent: "forest",
      logoDataUrl: "",
    },
    permissions: ["contacts.contacts.read"],
    roleNames: [],
    modules: [],
    offlineHours: 24,
    seatLimit: 5,
    memberCount: 1,
    authorizedAt: "2026-09-16T12:00:00.000Z",
    policyRevision: "9007199254740993",
  };
  const suspended = {
    ...before,
    permissions: [],
    offlineHours: 0,
    policyRevision: "9007199254740994",
    authorizedAt: "2026-09-16T12:00:01.000Z",
  };
  expect(newerPolicy(before, suspended)).toBe(suspended);
  expect(
    newerPolicy(suspended, {
      ...before,
      authorizedAt: "2026-09-16T12:00:02.000Z",
    }),
  ).toBe(suspended);
  expect(
    newerPolicy(suspended, { ...suspended, authorizedAt: before.authorizedAt }),
  ).toBe(suspended);
  const renewed = { ...suspended, authorizedAt: "2026-09-16T12:00:03.000Z" };
  expect(newerPolicy(suspended, renewed)).toBe(renewed);
  expect(newerPolicy(suspended, { ...before, policyRevision: undefined })).toBe(
    suspended,
  );
  const disk = {
    bootstrap: before,
    cachedAt: Date.parse(before.authorizedAt),
    expiresAt: Date.parse(before.authorizedAt) + 24 * 3600000,
    products: [],
    orders: [],
  };
  const restored = snapshotWithPolicy(disk, moduleCatalog, suspended);
  expect(restored.bootstrap).toBe(suspended);
  expect(restored.expiresAt).toBe(Date.parse(suspended.authorizedAt));
  expect(snapshotWithPolicy(restored, moduleCatalog, before).bootstrap).toBe(
    suspended,
  );
  expect(snapshotWithPolicy(disk, moduleCatalog)).toBe(disk);
});

// Deferred storage exercises the ordering that React effects and policy delivery share.
it("serializes policy withdrawal with an in-flight first snapshot and late stale writers", async () => {
  const { vi } = await import("vitest");
  const { persistSnapshotPolicy } =
    await import("../../packages/shell/src/features/administration/policy-delivery");
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
  let latest = policy;
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
  let started!: () => void;
  let release!: () => void;
  const writing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const platform = {
    load: async (s: typeof scope, key: string) =>
      structuredClone(disk.get(JSON.stringify([s, key]))),
    save: async (s: typeof scope, key: string, value: unknown) => {
      if (first) {
        first = false;
        started();
        await held;
      }
      disk.set(JSON.stringify([s, key]), structuredClone(value));
    },
  } as unknown as import("../../packages/client/src").Platform;
  const snapshot = {
    bootstrap: policy,
    cachedAt: Date.parse(policy.authorizedAt),
    expiresAt: Date.parse(policy.authorizedAt) + 86400000,
    products: [],
    orders: [],
  };
  const persist = (value?: typeof snapshot | null) =>
    persistSnapshotPolicy(platform, scope, moduleCatalog, () => latest, value);
  try {
    expect(await persist()).toBeUndefined(); // Receiving authority is not device consent.
    const firstWrite = persist(snapshot);
    await writing;
    latest = { ...policy, offlineHours: 0, policyRevision: "2" };
    const revoke = persist();
    release();
    await firstWrite;
    expect((await revoke)?.bootstrap.offlineHours).toBe(0);
    // Simulate another tab whose in-memory authority has not caught up.
    const stale = await persistSnapshotPolicy(
      platform,
      scope,
      moduleCatalog,
      () => policy,
      snapshot,
    );
    expect(stale?.bootstrap.policyRevision).toBe("2");
    expect(stale?.expiresAt).toBe(Date.parse(policy.authorizedAt));
    latest = { ...latest, offlineHours: 1, policyRevision: "3" };
    expect((await persist())?.expiresAt).toBe(
      Date.parse(policy.authorizedAt) + 3600000,
    );
    await expect(
      persistSnapshotPolicy(
        platform,
        { ...scope, workspaceId: "other" },
        moduleCatalog,
        () => latest,
        snapshot,
      ),
    ).rejects.toThrow("different workspace");
    expect(
      await persistSnapshotPolicy(
        platform,
        { ...scope, userId: "other" },
        moduleCatalog,
        () => latest,
      ),
    ).toBeUndefined();
    await persist(null);
    expect(await persist()).toBeUndefined();
  } finally {
    release();
    vi.unstubAllGlobals();
  }
});
