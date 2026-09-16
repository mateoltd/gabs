import { openDB } from "idb";
import type {
  ResourceRecord,
  ModuleDefinition,
  ModuleCall,
} from "@suite/module-sdk";
import {
  LocalExecutionError,
  type LocalReceipt,
} from "@suite/module-sdk/local";
import { LocalWorkerHost } from "./local-worker";
interface Vault {
  id: string;
  name: string;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  updatedAt: number;
  revision?: number;
}
export interface LocalData {
  records: Record<string, ResourceRecord[]>;
  receipts?: Record<string, Record<string, LocalReceipt>>;
}
const db = () =>
  openDB("suite-local-profiles", 1, {
    upgrade(db) {
      db.createObjectStore("vaults", { keyPath: "id" });
    },
  });
async function derive(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations: 600000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function listLocalProfiles() {
  return ((await (await db()).getAll("vaults")) as Vault[]).map(
    ({ id, name }) => ({ id, name }),
  );
}
export async function removeLocalProfile(id: string) {
  await (await db()).delete("vaults", id);
}
export interface LocalSession {
  id: string;
  name: string;
  readonly data: LocalData;
  execute(
    module: ModuleDefinition,
    call: ModuleCall,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      configuration?: unknown;
    },
  ): Promise<unknown>;
  lock(): void;
}
function session(vault: Vault, key: CryptoKey, data: LocalData): LocalSession {
  let unlocked: CryptoKey | undefined = key;
  let revision = vault.revision ?? 0;
  let tail: Promise<unknown> = Promise.resolve();
  const worker = new LocalWorkerHost();
  const current: LocalSession = {
    id: vault.id,
    name: vault.name,
    get data() {
      return structuredClone(data);
    },
    execute(module, call, options = {}) {
      module = structuredClone(module);
      call = structuredClone(call);
      options = {
        ...options,
        configuration: structuredClone(options.configuration ?? {}),
      };
      // Each transaction snapshots after the preceding durable commit.
      const task = tail.then(async () => {
        if (!unlocked)
          throw new LocalExecutionError(
            "PROFILE_LOCKED",
            "Unlock the local profile.",
          );
        const prefix = module.id + "/";
        const snapshot = {
          records: Object.fromEntries(
            Object.entries(data.records)
              .filter(([name]) => name.startsWith(prefix))
              .map(([name, rows]) => [name.slice(prefix.length), rows]),
          ),
          receipts: data.receipts?.[module.id] ?? {},
        };
        const result = await worker.run(
          module,
          {
            profileId: vault.id,
            call,
            configuration: options.configuration ?? {},
            snapshot,
          },
          options,
        );
        if (!unlocked)
          throw new LocalExecutionError(
            "PROFILE_LOCKED",
            "Unlock the local profile.",
          );
        if (options.signal?.aborted)
          throw new LocalExecutionError(
            "LOCAL_CANCELLED",
            "The local operation was cancelled.",
          );
        if (!["get", "list"].includes(call.action)) {
          const next: LocalData = {
            records: {
              ...data.records,
              ...Object.fromEntries(
                Object.entries(result.snapshot.records).map(([name, rows]) => [
                  prefix + name,
                  rows,
                ]),
              ),
            },
            receipts: {
              ...data.receipts,
              [module.id]: result.snapshot.receipts,
            },
          };
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const ciphertext = await crypto.subtle.encrypt(
            {
              name: "AES-GCM",
              iv,
              additionalData: new TextEncoder().encode(vault.id),
            },
            unlocked,
            new TextEncoder().encode(JSON.stringify(next)),
          );
          if (!unlocked)
            throw new LocalExecutionError(
              "PROFILE_LOCKED",
              "The profile was locked before this change was saved.",
            );
          if (options.signal?.aborted)
            throw new LocalExecutionError(
              "LOCAL_CANCELLED",
              "The local operation was cancelled.",
            );
          const connection = await db();
          const tx = connection.transaction("vaults", "readwrite");
          const stored = (await tx.store.get(vault.id)) as Vault | undefined;
          if (
            !unlocked ||
            options.signal?.aborted ||
            !stored ||
            (stored.revision ?? 0) !== revision
          ) {
            tx.abort();
            await tx.done.catch(() => {});
            if (!unlocked)
              throw new LocalExecutionError(
                "PROFILE_LOCKED",
                "Unlock the local profile.",
              );
            if (options.signal?.aborted)
              throw new LocalExecutionError(
                "LOCAL_CANCELLED",
                "The local operation was cancelled.",
              );
            throw new LocalExecutionError(
              "PROFILE_CHANGED",
              "This profile changed in another window or was removed. Unlock it again before saving.",
            );
          }
          // Cancellation after this durable commit has begun cannot undo accepted work.
          await tx.store.put({
            ...vault,
            iv,
            ciphertext,
            updatedAt: Date.now(),
            revision: revision + 1,
          });
          await tx.done;
          revision++;
          if (unlocked) data = next;
        }
        if (!unlocked)
          throw new LocalExecutionError(
            "PROFILE_LOCKED",
            "Unlock the profile and retry the same request to recover its outcome.",
          );
        return result.result;
      });
      tail = task.catch(() => {});
      return task;
    },
    lock() {
      unlocked = undefined;
      worker.close();
      data = { records: {} };
    },
  };
  return current;
}
export async function createLocalProfile(name: string, password: string) {
  if (name.trim().length < 1 || name.length > 100 || password.length < 12)
    throw Error("Enter a name and a passphrase of at least 12 characters.");
  const vault: Vault = {
    id: crypto.randomUUID(),
    name: name.trim(),
    salt: crypto.getRandomValues(new Uint8Array(16)),
    iv: new Uint8Array(12),
    ciphertext: new ArrayBuffer(0),
    updatedAt: Date.now(),
  };
  const key = await derive(password, vault.salt);
  const data: LocalData = { records: {} };
  vault.iv = crypto.getRandomValues(new Uint8Array(12));
  vault.ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: vault.iv as Uint8Array<ArrayBuffer>,
      additionalData: new TextEncoder().encode(vault.id),
    },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  );
  vault.revision = 0;
  await (await db()).add("vaults", vault);
  return session(vault, key, data);
}
export async function unlockLocalProfile(id: string, password: string) {
  const vault = (await (await db()).get("vaults", id)) as Vault | undefined;
  if (!vault) throw Error("Local profile not found.");
  try {
    const key = await derive(password, vault.salt),
      bytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: vault.iv as Uint8Array<ArrayBuffer>,
          additionalData: new TextEncoder().encode(id),
        },
        key,
        vault.ciphertext,
      );
    return session(
      vault,
      key,
      JSON.parse(new TextDecoder().decode(bytes)) as LocalData,
    );
  } catch {
    throw Error(
      "The local profile could not be unlocked. Check the passphrase.",
    );
  }
}
