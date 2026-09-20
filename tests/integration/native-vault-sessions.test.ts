import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
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
  let prompts = 0,
    generation = 1;
  const providerKeys = new Map([
    [1, randomBytes(32)],
    [2, randomBytes(32)],
  ]);
  // Controlled provider only. This verifies utility custody, not OS key protection.
  const protection = new NativeLocalUnlock({
    available: () => true,
    biometricAvailable: () => true,
    biometric: async () => {
      prompts++;
    },
    encrypt: async (text) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv(
        "aes-256-gcm",
        providerKeys.get(generation)!,
        iv,
      );
      const payload = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([
        Buffer.from([generation]),
        iv,
        cipher.getAuthTag(),
        payload,
      ]);
    },
    decrypt: async (value) => {
      const bytes = Buffer.from(value);
      const providerKey = providerKeys.get(bytes[0]);
      if (!providerKey) throw Error("Provider key retired");
      const cipher = createDecipheriv(
        "aes-256-gcm",
        providerKey,
        bytes.subarray(1, 13),
      );
      cipher.setAuthTag(bytes.subarray(13, 29));
      return {
        result: Buffer.concat([
          cipher.update(bytes.subarray(29)),
          cipher.final(),
        ]).toString(),
        shouldReEncrypt: bytes[0] !== generation,
      };
    },
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
    return { db, sessions, call, store };
  };
  cleanup.push(() => {
    for (const db of connections) if (db.open) db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    start,
    path,
    changes,
    prompts: () => prompts,
    protection,
    rotate: () => {
      generation = 2;
    },
    retire: () => providerKeys.delete(1),
  };
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
    "session",
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
    "session",
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

async function enrolled(f: ReturnType<typeof fixture>) {
  const s = f.start();
  const created = (await s.call({
    action: "create",
    input: { name: "Renewable", password, data: { note: "retained work" } },
  })) as OpenedNativeVault;
  await s.call({
    action: "configure",
    input: {
      id: created.profile.id,
      password,
      pin: "12345678",
      biometric: true,
    },
  });
  const original = (await s.store.get(created.profile.id))!;
  return { s, original, id: created.profile.id };
}

it.each(["pin", "biometric"] as const)(
  "%s unlock renews both envelopes atomically and preserves data after provider retirement and database restart",
  async (method) => {
    const f = fixture();
    const { s, id, original } = await enrolled(f);
    f.rotate();
    const prompts = f.prompts();
    const grant = (await s.call({
      action: "quickUnlock",
      input: { id, method, pin: "12345678" },
    })) as OpenedNativeVault;
    expect(grant.data).toEqual({ note: "retained work" });
    expect(f.prompts() - prompts).toBe(method === "biometric" ? 1 : 0);
    const renewed = (await s.store.get(id))!;
    expect(renewed.ciphertext).toEqual(original.ciphertext);
    expect(renewed.revision).toBe(original.revision);
    expect(renewed.unlock?.epoch).toBe(original.unlock?.epoch);
    expect(renewed.unlock?.pin).not.toEqual(original.unlock?.pin);
    expect(renewed.unlock?.biometric).not.toBe(original.unlock?.biometric);
    f.retire();
    s.sessions.close();
    s.db.close();
    const reopened = f.start();
    for (const method of ["pin", "biometric"] as const) {
      const accepted = (await reopened.call({
        action: "quickUnlock",
        input: { id, method, pin: "12345678" },
      })) as OpenedNativeVault;
      expect(accepted.data).toEqual({ note: "retained work" });
      expect("key" in accepted).toBe(false);
    }
    expect(
      (
        (await reopened.call({
          action: "unlock",
          input: { id, password },
        })) as OpenedNativeVault
      ).data,
    ).toEqual({ note: "retained work" });
  },
);

it("a rejected PIN never renews envelopes, and failure renewing the second envelope commits neither", async () => {
  const f = fixture();
  const { s, id, original } = await enrolled(f);
  f.rotate();
  const renew = f.protection.renew.bind(f.protection);
  const calls = vi.spyOn(f.protection, "renew");
  await expect(
    s.call({
      action: "quickUnlock",
      input: { id, method: "pin", pin: "87654321" },
    }),
  ).rejects.toThrow("PIN was not accepted");
  expect(calls).not.toHaveBeenCalled();
  const failed = (await s.store.get(id))!;
  expect(failed.unlock?.failures).toBe(1);
  expect(failed.unlock?.pin).toEqual(original.unlock?.pin);
  calls.mockImplementation(async (scope, sealed) => {
    if (scope.kind === "biometric") throw Error("Renewal unavailable");
    return renew(scope, sealed);
  });
  await expect(
    s.call({
      action: "quickUnlock",
      input: { id, method: "pin", pin: "12345678" },
    }),
  ).rejects.toThrow("Renewal unavailable");
  expect(await s.store.get(id)).toEqual(failed);
  calls.mockRestore();
  await s.call({
    action: "quickUnlock",
    input: { id, method: "pin", pin: "12345678" },
  });
  expect((await s.store.get(id))?.unlock?.failures).toBe(0);
});

it.each(["cancel", "remove", "edit"] as const)(
  "%s during renewal cannot commit stale wrappers or overwrite current vault data",
  async (action) => {
    const f = fixture();
    const { s, id, original } = await enrolled(f);
    const access = (await s.call({
      action: "unlock",
      input: { id, password },
    })) as OpenedNativeVault;
    f.rotate();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const renew = f.protection.renew.bind(f.protection);
    const spy = vi
      .spyOn(f.protection, "renew")
      .mockImplementationOnce(async (...args) => {
        entered();
        await hold;
        return renew(...args);
      });
    const controller = new AbortController();
    const pending = s
      .call(
        {
          action: "quickUnlock",
          input: { id, method: "pin", pin: "12345678" },
        },
        controller.signal,
      )
      .then(
        () => false,
        () => true,
      );
    await started;
    if (action === "cancel") controller.abort();
    if (action === "remove") await s.call({ action: "remove", input: { id } });
    if (action === "edit")
      await s.call({
        action: "commit",
        input: {
          handle: access.handle,
          revision: access.revision,
          value: { note: "newer saved work" },
        },
      });
    release();
    expect(await pending).toBe(true);
    spy.mockRestore();
    const current = (await s.store.get(id))!;
    expect(current.unlock).toEqual(
      action === "remove" ? undefined : original.unlock,
    );
    if (action === "edit")
      expect(
        (
          (await s.call({
            action: "unlock",
            input: { id, password },
          })) as OpenedNativeVault
        ).data,
      ).toEqual({ note: "newer saved work" });
    else expect(current.ciphertext).toEqual(original.ciphertext);
  },
);
