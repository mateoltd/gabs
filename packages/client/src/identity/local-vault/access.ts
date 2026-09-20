import type { LocalUnlockStatus } from "./contracts";

/** An unlocked vault is an opaque capability. Consumers never receive encryption keys. */
export interface LocalVaultAccess {
  readonly profile: { id: string; name: string };
  readonly data: unknown;
  readonly revision: number;
  assert(): Promise<void>;
  commit(
    value: unknown,
    signal: AbortSignal | undefined,
    current: () => boolean,
  ): Promise<void>;
  close(): void;
}
export interface LocalVaultProvider {
  readonly kind: "browser" | "desktop";
  list(): Promise<{ id: string; name: string }[]>;
  removed(): Promise<{ id: string; name: string; removedAt: number }[]>;
  remove(id: string): Promise<void>;
  subscribe(listener: (id: string, invalidate?: boolean) => void): () => void;
  create(
    name: string,
    password: string,
    data: unknown,
  ): Promise<LocalVaultAccess>;
  unlock(id: string, password: string): Promise<LocalVaultAccess>;
  restore(
    id: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<LocalVaultAccess>;
  quickUnlock(
    id: string,
    method: "pin" | "biometric",
    pin: string,
    signal?: AbortSignal,
  ): Promise<LocalVaultAccess>;
  status(id: string): Promise<LocalUnlockStatus>;
  configure(
    id: string,
    password: string,
    pin: string | undefined,
    biometric: boolean,
    signal?: AbortSignal,
  ): Promise<void>;
}
