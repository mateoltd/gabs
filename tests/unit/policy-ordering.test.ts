import { it, expect } from "vitest";
import type { Bootstrap } from "../../packages/contracts/src";
import {
  newerPolicy,
  snapshotWithPolicy,
} from "../../packages/shell/src/features/administration/policy";
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
