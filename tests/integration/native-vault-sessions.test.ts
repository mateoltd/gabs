import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { deserialize } from "node:v8";
import type { LocalVault } from "../../packages/client/src/identity/local-vault/contracts";
import { openProtectedDatabase } from "../../apps/desktop/src/utility/storage/database";
import {
  localVaultStore,
  importLocalVaults,
} from "../../apps/desktop/src/utility/storage/local-vaults";
import { NativeVaultSessions } from "../../apps/desktop/src/utility/storage/vault-sessions";
import { NativeLocalUnlock } from "../../apps/desktop/src/main/identity/local-unlock";
import type {
  LocalVaultRequest,
  OpenedNativeVault,
} from "../../packages/client/src/identity/local-vault/protocol";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "suite-native-vault-"));
  const path = join(dir, "cache.sqlite");
  const key = randomBytes(32);
  const connections: ReturnType<typeof openProtectedDatabase>[] = [];
  const changes: string[] = [];
  let prompts = 0;
  // Controlled provider only. This verifies utility custody, not OS key protection.
  const protection = new NativeLocalUnlock({
    available: () => true,
    biometricAvailable: () => true,
    biometric: async () => {
      prompts++;
    },
    encrypt: async (text) => Buffer.from(text),
    decrypt: async (bytes) => Buffer.from(bytes).toString(),
  });
  const start = () => {
    const db = openProtectedDatabase(path, key, () => {
      throw Error("No legacy corporate cache in this fixture");
    });
    connections.push(db);
    const store = localVaultStore(db, (id) => changes.push(id));
    const sessions = new NativeVaultSessions(
      store,
      protection,
      async (vaults) => importLocalVaults(db, vaults),
    );
    const call = (
      request: LocalVaultRequest,
      signal = new AbortController().signal,
    ) => sessions.run(request, signal);
    return { db, sessions, call };
  };
  cleanup.push(() => {
    for (const db of connections) if (db.open) db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { start, path, changes, prompts: () => prompts };
}
const password = "correct horse battery staple";
it("keeps keys behind opaque grants, persists records and rejects stale grants across close and restart", async () => {
  const f = fixture();
  let s = f.start();
  const created = (await s.call({
    action: "create",
    input: {
      name: "Private local company",
      password,
      data: {
        records: { contacts: [{ id: "contact-1", name: "Private person" }] },
      },
    },
  })) as OpenedNativeVault;
  expect(Object.keys(created).sort()).toEqual([
    "data",
    "generation",
    "handle",
    "profile",
    "revision",
  ]);
  expect(created.profile.name).toBe("Private local company");
  const second = (await s.call({
    action: "unlock",
    input: { id: created.profile.id, password },
  })) as OpenedNativeVault;
  const data = {
    records: { contacts: [{ id: "contact-1", name: "Updated person" }] },
  };
  expect(
    await s.call({
      action: "commit",
      input: { handle: created.handle, revision: 0, value: data },
    }),
  ).toBe(1);
  await expect(
    s.call({
      action: "commit",
      input: { handle: second.handle, revision: 0, value: { records: {} } },
    }),
  ).rejects.toMatchObject({ code: "PROFILE_CHANGED" });
  await s.call({ action: "close", input: { handle: created.handle } });
  await expect(
    s.call({
      action: "assert",
      input: { handle: created.handle, revision: 1 },
    }),
  ).rejects.toMatchObject({ code: "PROFILE_LOCKED" });
  s.sessions.close();
  s.db.close();
  const bytes = readFileSync(`${f.path}.protected`);
  expect(bytes.includes(Buffer.from(created.profile.id))).toBe(false);
  expect(bytes.includes(Buffer.from("Private local company"))).toBe(false);
  s = f.start();
  await expect(
    s.call({ action: "assert", input: { handle: second.handle, revision: 0 } }),
  ).rejects.toMatchObject({ code: "PROFILE_LOCKED" });
  await expect(
    s.call({
      action: "unlock",
      input: { id: created.profile.id, password: "incorrect passphrase" },
    }),
  ).rejects.toThrow("could not be unlocked");
  const reopened = (await s.call({
    action: "unlock",
    input: { id: created.profile.id, password },
  })) as OpenedNativeVault;
  expect(reopened.data).toEqual(data);
});
it("revokes a pending encrypted write before commit when the renderer session closes", async () => {
  const s = fixture().start();
  const created = (await s.call({
    action: "create",
    input: { name: "Locked", password, data: { records: {} } },
  })) as OpenedNativeVault;
  const saving = s.call({
    action: "commit",
    input: {
      handle: created.handle,
      revision: 0,
      value: { records: { lost: [{ value: "must not commit" }] } },
    },
  });
  s.sessions.close();
  await expect(saving).rejects.toMatchObject({ code: "PROFILE_LOCKED" });
  const restored = (await s.call({
    action: "unlock",
    input: { id: created.profile.id, password },
  })) as OpenedNativeVault;
  expect(restored.data).toEqual({ records: {} });
});
it("enrolls PIN and biometric recovery without returning keys, and fences grants on removal/restoration", async () => {
  const f = fixture();
  const s = f.start();
  const created = (await s.call({
    action: "create",
    input: {
      name: "PIN profile",
      password,
      data: { records: { note: [{ id: "retained" }] } },
    },
  })) as OpenedNativeVault;
  const id = created.profile.id;
  await s.call({
    action: "configure",
    input: { id, password, pin: "12345678", biometric: true },
  });
  await expect(
    s.call({
      action: "assert",
      input: { handle: created.handle, revision: 0 },
    }),
  ).rejects.toMatchObject({ code: "PROFILE_LOCKED" });
  await expect(
    s.call({
      action: "quickUnlock",
      input: { id, method: "pin", pin: "87654321" },
    }),
  ).rejects.toThrow("PIN was not accepted");
  const pin = (await s.call({
    action: "quickUnlock",
    input: { id, method: "pin", pin: "12345678" },
  })) as OpenedNativeVault;
  expect(Object.keys(pin).sort()).toEqual([
    "data",
    "generation",
    "handle",
    "profile",
    "revision",
  ]);
  expect(pin.data).toEqual(created.data);
  const bio = (await s.call({
    action: "quickUnlock",
    input: { id, method: "biometric", pin: "" },
  })) as OpenedNativeVault;
  expect(bio.data).toEqual(created.data);
  expect(f.prompts()).toBe(2);
  await s.call({ action: "remove", input: { id } });
  await expect(
    s.call({
      action: "assert",
      input: { handle: pin.handle, revision: pin.revision },
    }),
  ).rejects.toMatchObject({ code: "PROFILE_LOCKED" });
  expect(await s.call({ action: "list", input: { removed: false } })).toEqual(
    [],
  );
  const recovered = (await s.call({
    action: "restore",
    input: { id, password },
  })) as OpenedNativeVault;
  expect(recovered.data).toEqual(created.data);
  expect(await s.call({ action: "status", input: { id } })).toMatchObject({
    enabled: false,
    biometric: false,
  });
  expect(f.changes.filter((value) => value === id)).toHaveLength(4);
});

it("migrates original passphrase envelopes idempotently without replacing newer native work", async () => {
  const original = fixture().start();
  const created = (await original.call({
    action: "create",
    input: {
      name: "Original browser profile",
      password,
      data: { records: { pending: [{ id: "stable-input" }] } },
    },
  })) as OpenedNativeVault;
  const row = original.db
    .prepare<[string], { envelope: Buffer }>(
      "SELECT envelope FROM local_vaults WHERE id=?",
    )
    .get(created.profile.id)!;
  const vault = deserialize(row.envelope) as LocalVault;
  const f = fixture();
  let native = f.start();
  expect(
    await native.call({ action: "import", input: { vaults: [vault] } }),
  ).toEqual([vault.id]);
  const opened = (await native.call({
    action: "unlock",
    input: { id: vault.id, password },
  })) as OpenedNativeVault;
  expect(opened.data).toEqual(created.data);
  await native.call({
    action: "commit",
    input: {
      handle: opened.handle,
      revision: opened.revision,
      value: { records: { pending: [{ id: "stable-input", resolved: true }] } },
    },
  });
  native.sessions.close();
  native.db.close();
  native = f.start();
  expect(
    await native.call({ action: "import", input: { vaults: [vault] } }),
  ).toEqual([vault.id]);
  const newer = (await native.call({
    action: "unlock",
    input: { id: vault.id, password },
  })) as OpenedNativeVault;
  expect(newer.data).toEqual({
    records: { pending: [{ id: "stable-input", resolved: true }] },
  });
  const changed = { ...vault, name: "Changed original" };
  await expect(
    native.call({ action: "import", input: { vaults: [changed] } }),
  ).rejects.toThrow("original encrypted data is retained");
  expect(
    await native.call({ action: "list", input: { removed: false } }),
  ).toEqual([{ id: vault.id, name: vault.name }]);
});
it("rejects invalid envelope batches atomically and revokes an issued handle on late cancellation", async () => {
  const original = fixture().start();
  const requestId = crypto.randomUUID();
  const created = (await original.sessions.run(
    {
      action: "create",
      input: { name: "Cancellable", password, data: { records: {} } },
    },
    new AbortController().signal,
    requestId,
  )) as OpenedNativeVault;
  original.sessions.cancel(requestId);
  await expect(
    original.call({
      action: "assert",
      input: { handle: created.handle, revision: created.revision },
    }),
  ).rejects.toMatchObject({ code: "PROFILE_LOCKED" });
  const row = original.db
    .prepare<[string], { envelope: Buffer }>(
      "SELECT envelope FROM local_vaults WHERE id=?",
    )
    .get(created.profile.id)!;
  const vault = deserialize(row.envelope) as LocalVault;
  const native = fixture().start();
  await expect(
    native.call({
      action: "import",
      input: {
        vaults: [
          vault,
          { ...vault, id: crypto.randomUUID(), salt: new Uint8Array(1) },
        ],
      },
    }),
  ).rejects.toThrow("Invalid encrypted local profile");
  expect(
    await native.call({ action: "list", input: { removed: false } }),
  ).toEqual([]);
});
