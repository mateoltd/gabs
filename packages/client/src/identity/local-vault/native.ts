import { LocalExecutionError } from "@suite/module-sdk/local";
import type { LocalVaultAccess, LocalVaultProvider } from "./access";
import type {
  NativeVaultBridge,
  LocalVaultOperations,
  OpenedNativeVault,
} from "./protocol";
import { openLocalVaultDatabase } from "./store";
import { vaultEnvelope } from "./envelope";

export function createNativeVaultProvider(
  bridge: NativeVaultBridge,
): LocalVaultProvider {
  let migration: Promise<void> | undefined;
  const active = new Set<LocalVaultAccess>();
  const issued = new Map<string, number>();
  const listeners = new Set<(id: string, invalidate?: boolean) => void>();
  const call = async <K extends keyof LocalVaultOperations>(
    action: K,
    input: LocalVaultOperations[K]["input"],
    signal?: AbortSignal,
  ): Promise<LocalVaultOperations[K]["output"]> => {
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    const cancel = () => {
      void bridge.cancel(id).catch(() => {});
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await bridge.request(id, action, input);
    } catch (error) {
      cancel();
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  };
  const migrate = () =>
    (migration ??= (async () => {
      const connection = await openLocalVaultDatabase();
      const vaults = await connection.getAll("vaults");
      if (!vaults.length) return;
      const imported = await call("import", { vaults });
      if (
        imported.length !== vaults.length ||
        vaults.some((v) => !imported.includes(v.id))
      )
        throw Error(
          "Local profile migration was not acknowledged. Original data is retained.",
        );
      const tx = connection.transaction("vaults", "readwrite");
      try {
        for (const vault of vaults) {
          const stored = await tx.store.get(vault.id);
          if (stored && vaultEnvelope(stored) !== vaultEnvelope(vault))
            throw Error(
              "The local profile changed during migration. Original data is retained.",
            );
          if (stored) await tx.store.delete(vault.id);
        }
        await tx.done;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already finished. */
        }
        await tx.done.catch(() => {});
        throw error;
      }
    })().catch((error) => {
      migration = undefined;
      throw error;
    }));
  async function ready<K extends keyof LocalVaultOperations>(
    action: K,
    input: LocalVaultOperations[K]["input"],
    signal?: AbortSignal,
  ) {
    await migrate();
    return call(action, input, signal);
  }
  function access(
    opened: OpenedNativeVault,
    signal?: AbortSignal,
  ): LocalVaultAccess {
    const handle = opened.handle;
    issued.set(
      opened.profile.id,
      Math.max(issued.get(opened.profile.id) ?? -1, opened.generation),
    );
    let unlocked = true,
      revision = opened.revision,
      data = opened.data;
    const assert = () => {
      if (!unlocked)
        throw new LocalExecutionError(
          "PROFILE_LOCKED",
          "Unlock the local profile.",
        );
    };
    const held: LocalVaultAccess = {
      profile: opened.profile,
      get data() {
        return data;
      },
      get revision() {
        return revision;
      },
      async assert() {
        assert();
        await call("assert", { handle, revision });
        assert();
      },
      async commit(value, signal, current) {
        assert();
        if (!current())
          throw new LocalExecutionError(
            "PROFILE_LOCKED",
            "Unlock the local profile.",
          );
        revision = await call("commit", { handle, revision, value }, signal);
        assert();
        if (!current())
          throw new LocalExecutionError(
            "PROFILE_LOCKED",
            "Unlock the local profile.",
          );
      },
      close() {
        if (!unlocked) return;
        unlocked = false;
        data = undefined;
        active.delete(held);
        void call("close", { handle }).catch(() => {});
      },
    };
    active.add(held);
    if (signal?.aborted) {
      held.close();
      signal.throwIfAborted();
    }
    return held;
  }
  bridge.subscribe(({ id, generation }) => {
    const invalidate = generation > (issued.get(id) ?? -1);
    if (invalidate)
      for (const held of active) if (held.profile.id === id) held.close();
    for (const listener of listeners) listener(id, invalidate);
  });
  return {
    kind: "desktop",
    async list() {
      return (await ready("list", { removed: false })).map(({ id, name }) => ({
        id,
        name,
      }));
    },
    async removed() {
      return (await ready("list", { removed: true })).map(
        ({ id, name, removedAt }) => {
          if (removedAt === undefined) throw Error("Invalid removed profile.");
          return { id, name, removedAt };
        },
      );
    },
    remove: (id) => ready("remove", { id }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async create(name, password, data) {
      return access(await ready("create", { name, password, data }));
    },
    async unlock(id, password) {
      return access(await ready("unlock", { id, password }));
    },
    async restore(id, password, signal) {
      return access(await ready("restore", { id, password }, signal), signal);
    },
    async quickUnlock(id, method, pin, signal) {
      return access(
        await ready("quickUnlock", { id, method, pin }, signal),
        signal,
      );
    },
    status: (id) => ready("status", { id }),
    configure: (id, password, pin, biometric, signal) =>
      ready("configure", { id, password, pin, biometric }, signal),
  };
}
