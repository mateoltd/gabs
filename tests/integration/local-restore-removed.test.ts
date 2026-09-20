import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createVaultEngine } from "../../packages/client/src/identity/local-vault/engine";
import type { LocalData } from "../../packages/client/src/identity/local-profiles";
import { localVaultStore } from "../../apps/desktop/src/utility/storage/local-vaults";
import { openProtectedDatabase } from "../../apps/desktop/src/utility/storage/database";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));
async function fixture(data: unknown) {
  const root = mkdtempSync(join(tmpdir(), "suite-removed-recovery-"));
  const db = openProtectedDatabase(
    join(root, "local.sqlite"),
    randomBytes(32),
    () => {
      throw Error("Unexpected legacy database");
    },
  );
  cleanups.push(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const changed = vi.fn();
  const store = localVaultStore(db, changed);
  const engine = createVaultEngine(store);
  const { vault } = await engine.createVault(
    "Removed backup",
    "original profile passphrase",
    data,
  );
  await engine.removeLocalProfile(vault.id);
  const original = await store.update(vault.id, (stored) => ({
    ...stored!,
    recoveryRequired: true,
  }));
  changed.mockClear();
  return { store, engine, original, changed };
}

it("keeps a removed backup hidden when its encrypted recovery data is invalid", async () => {
  const f = await fixture({
    records: {},
    deviceRequests: { broken: { id: "different", state: "pending" } },
  });
  await expect(
    f.engine.restoreVault(f.original.id, "original profile passphrase"),
  ).rejects.toThrow("device journal");
  expect(await f.store.get(f.original.id)).toEqual(f.original);
  expect(await f.engine.listLocalProfiles()).toEqual([]);
  expect(f.changed).not.toHaveBeenCalled();
});

it("activates a removed backup and its safeguards in one durable update", async () => {
  const f = await fixture({
    records: {},
    capabilityGrants: [{ id: "old-device" }],
    deviceRequests: {
      effect: { id: "effect", state: "pending", attemptId: "retained-attempt" },
    },
  });
  const update = vi.spyOn(f.store, "update");
  const recovered = await f.engine.restoreVault<LocalData>(
    f.original.id,
    "original profile passphrase",
  );
  expect(update).toHaveBeenCalledTimes(1);
  expect(recovered.vault.revision).toBe(f.original.revision! + 1);
  expect(recovered.vault.removedAt).toBeUndefined();
  expect(recovered.vault.recoveryRequired).toBeUndefined();
  expect(recovered.data.capabilityGrants).toEqual([]);
  expect(recovered.data.deviceRequests?.effect).toMatchObject({
    state: "uncertain",
    attemptId: "retained-attempt",
  });
  const reopened = await createVaultEngine(f.store).unlockVault<LocalData>(
    f.original.id,
    "original profile passphrase",
  );
  expect(reopened.data).toEqual(recovered.data);
  expect(f.changed).toHaveBeenCalledTimes(1);
});

it("does not activate a removed backup if cancellation wins before its commit", async () => {
  const f = await fixture({ records: {}, capabilityGrants: [] });
  const controller = new AbortController();
  const update = f.store.update.bind(f.store);
  f.store.update = (id, change) => {
    controller.abort();
    return update(id, change);
  };
  await expect(
    f.engine.restoreVault(
      f.original.id,
      "original profile passphrase",
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(await f.store.get(f.original.id)).toEqual(f.original);
  expect(f.changed).not.toHaveBeenCalled();
});
