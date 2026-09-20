import { LocalExecutionError } from "@suite/module-sdk/local";
import { createVaultEngine } from "./engine";
import { browserVaultStore, subscribeLocalProfiles } from "./store";
import type { LocalVault, LocalUnlockProtection } from "./contracts";
import type { LocalVaultAccess, LocalVaultProvider } from "./access";

export function createBrowserVaultProvider(
  protection?: LocalUnlockProtection,
): LocalVaultProvider {
  const engine = createVaultEngine(browserVaultStore);
  function access(
    vault: LocalVault,
    key: CryptoKey,
    data: unknown,
  ): LocalVaultAccess {
    let held: CryptoKey | undefined = key;
    let revision = vault.revision ?? 0;
    let snapshot = data;
    const unlocked = () => {
      if (!held)
        throw new LocalExecutionError(
          "PROFILE_LOCKED",
          "Unlock the local profile.",
        );
      return held;
    };
    return {
      profile: { id: vault.id, name: vault.name },
      get data() {
        return snapshot;
      },
      get revision() {
        return revision;
      },
      async assert() {
        unlocked();
        await engine.assertVaultRevision(vault, revision);
        unlocked();
      },
      async commit(value, signal, current) {
        const key = unlocked();
        revision = await engine.commitVault(
          vault,
          key,
          value,
          revision,
          signal,
          () => held === key && current(),
        );
      },
      close() {
        held = undefined;
        snapshot = undefined;
      },
    };
  }
  return {
    kind: "browser",
    list: engine.listLocalProfiles,
    removed: engine.listRemovedLocalProfiles,
    remove: engine.removeLocalProfile,
    subscribe: subscribeLocalProfiles,
    async create(name, password, data) {
      const { vault, key } = await engine.createVault(name, password, data);
      return access(vault, key, data);
    },
    async unlock(id, password) {
      const { vault, key, data } = await engine.unlockVault(id, password);
      return access(vault, key, data);
    },
    async restore(id, password, signal) {
      const { vault, key, data } = await engine.restoreVault(
        id,
        password,
        signal,
      );
      return access(vault, key, data);
    },
    async quickUnlock(id, method, pin, signal) {
      const { vault, key, data } = await engine.unlockLocalVault(
        id,
        method,
        pin,
        protection,
        signal,
      );
      return access(vault, key, data);
    },
    status: (id) => engine.localUnlockStatus(id, protection),
    configure: (id, password, pin, biometric, signal) =>
      engine.configureLocalUnlock(
        id,
        password,
        pin,
        biometric,
        protection,
        signal,
      ),
  };
}
