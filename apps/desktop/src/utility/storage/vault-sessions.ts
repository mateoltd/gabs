import {
  createVaultEngine,
  type LocalVaultStore,
  type LocalVault,
  type LocalUnlockProtection,
} from "@suite/client/vault-engine";
import { LocalExecutionError } from "@suite/module-sdk/local";
import type {
  LocalVaultRequest,
  OpenedNativeVault,
} from "@suite/client/vault-protocol";

interface HeldVault {
  vault: LocalVault;
  key: CryptoKey;
  revision: number;
  requestId: string;
}
/** Encryption keys remain here. Renderer handles are random, revocable and revision-bound. */
export class NativeVaultSessions {
  readonly session: string;
  private changeGeneration = 0;
  get generation() {
    return this.changeGeneration;
  }
  private readonly held = new Map<string, HeldVault>();
  private readonly engine: ReturnType<typeof createVaultEngine>;
  constructor(
    private readonly store: LocalVaultStore,
    private readonly protection: LocalUnlockProtection,
    private readonly importVaults: (vaults: LocalVault[]) => Promise<string[]>,
    session: string = crypto.randomUUID(),
  ) {
    this.session = session;
    this.engine = createVaultEngine({
      ...store,
      changed: (id) => {
        this.invalidate(id);
        store.changed(id);
      },
    });
  }
  invalidate(id: string) {
    this.changeGeneration++;
    for (const [handle, lease] of this.held)
      if (lease.vault.id === id) this.held.delete(handle);
  }
  cancel(requestId: string) {
    for (const [handle, lease] of this.held)
      if (lease.requestId === requestId) this.held.delete(handle);
  }
  close() {
    this.changeGeneration++;
    const profiles = new Set(
      [...this.held.values()].map((lease) => lease.vault.id),
    );
    this.held.clear();
    for (const id of profiles) this.store.changed(id);
  }
  private issue(
    result: { vault: LocalVault; key: CryptoKey; data: unknown },
    signal: AbortSignal,
    requestId: string,
  ): OpenedNativeVault {
    signal.throwIfAborted();
    // A renderer must release its previous grant; cap abandoned handles as a second bound.
    if (this.held.size >= 32)
      throw Error("Close an open local profile before unlocking another.");
    const { vault, key, data } = result;
    const handle = crypto.randomUUID();
    const revision = vault.revision ?? 0;
    this.held.set(handle, { vault, key, revision, requestId });
    return {
      session: this.session,
      generation: this.changeGeneration,
      handle,
      profile: { id: vault.id, name: vault.name },
      revision,
      data,
    };
  }
  private current(handle: string, revision: number) {
    const lease = this.held.get(handle);
    if (!lease)
      throw new LocalExecutionError(
        "PROFILE_LOCKED",
        "Unlock the local profile.",
      );
    if (!Number.isSafeInteger(revision) || revision !== lease.revision)
      throw new LocalExecutionError(
        "PROFILE_CHANGED",
        "Unlock the local profile again before continuing.",
      );
    return lease;
  }
  async run(
    request: LocalVaultRequest,
    signal: AbortSignal,
    requestId: string = crypto.randomUUID(),
  ): Promise<unknown> {
    signal.throwIfAborted();
    switch (request.action) {
      case "list":
        return request.input.removed
          ? this.engine.listRemovedLocalProfiles()
          : this.engine.listLocalProfiles();
      case "create": {
        const { name, password, data } = request.input;
        const result = await this.engine.createVault(name, password, data);
        return this.issue({ ...result, data }, signal, requestId);
      }
      case "unlock":
        return this.issue(
          await this.engine.unlockVault(
            request.input.id,
            request.input.password,
            signal,
          ),
          signal,
          requestId,
        );
      case "restore":
        return this.issue(
          await this.engine.restoreVault(
            request.input.id,
            request.input.password,
            signal,
          ),
          signal,
          requestId,
        );
      case "quickUnlock":
        return this.issue(
          await this.engine.unlockLocalVault(
            request.input.id,
            request.input.method,
            request.input.pin,
            this.protection,
            signal,
          ),
          signal,
          requestId,
        );
      case "status":
        return this.engine.localUnlockStatus(request.input.id, this.protection);
      case "configure":
        return this.engine.configureLocalUnlock(
          request.input.id,
          request.input.password,
          request.input.pin,
          request.input.biometric,
          this.protection,
          signal,
        );
      case "remove":
        return this.engine.removeLocalProfile(request.input.id);
      case "close":
        this.held.delete(request.input.handle);
        return;
      case "assert": {
        const lease = this.current(
          request.input.handle,
          request.input.revision,
        );
        await this.engine.assertVaultRevision(lease.vault, lease.revision);
        this.current(request.input.handle, request.input.revision);
        return;
      }
      case "commit": {
        const { handle, revision, value } = request.input;
        const lease = this.current(handle, revision);
        const next = await this.engine.commitVault(
          lease.vault,
          lease.key,
          value,
          revision,
          signal,
          () => this.held.get(handle) === lease,
        );
        lease.revision = next;
        return next;
      }
      case "import":
        return this.importVaults(request.input.vaults);
      default:
        throw Error("Unknown local vault operation.");
    }
  }
}
