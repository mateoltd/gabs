import { verifyArtifact } from "@suite/module-sdk/verification";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import { resolveReleases } from "@suite/module-sdk/registry";
import {
  hydrateModule,
  assertSchema,
  storageContract,
} from "@suite/module-sdk";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import { moduleDefinitions } from "@suite/module-catalog";
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
export interface LocalRelease {
  package: SignedArtifact;
  publicKey: string;
  configuration: unknown;
}
export interface LocalInstallation {
  active: boolean;
  version: string;
  releases: Record<string, LocalRelease>;
}
export interface LocalData {
  modules?: Record<string, LocalInstallation>;
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
  /** The host supplies the official registry trust key, never a key from the package. */
  install(
    pkg: SignedArtifact,
    publicKey: string,
    configuration?: unknown,
  ): Promise<void>;
  uninstall(moduleId: string): Promise<void>;
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
  const unlockedOrThrow = () => {
    if (!unlocked)
      throw new LocalExecutionError(
        "PROFILE_LOCKED",
        "Unlock the local profile.",
      );
  };
  const enqueue = <T>(run: () => Promise<T>) => {
    const task = tail.then(async () => {
      unlockedOrThrow();
      return run();
    });
    tail = task.catch(() => {});
    return task;
  };
  async function commit(next: LocalData, signal?: AbortSignal) {
    if (!unlocked)
      throw new LocalExecutionError(
        "PROFILE_LOCKED",
        "Unlock the local profile.",
      );
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
    if (signal?.aborted)
      throw new LocalExecutionError(
        "LOCAL_CANCELLED",
        "The local operation was cancelled.",
      );
    const connection = await db();
    const tx = connection.transaction("vaults", "readwrite");
    const stored = (await tx.store.get(vault.id)) as Vault | undefined;
    if (
      !unlocked ||
      signal?.aborted ||
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
      if (signal?.aborted)
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
    unlockedOrThrow();
  }
  const current: LocalSession = {
    id: vault.id,
    name: vault.name,
    get data() {
      return structuredClone(data);
    },
    install(pkg, publicKey, configuration = {}) {
      pkg = structuredClone(pkg);
      configuration = structuredClone(configuration);
      return enqueue(async () => {
        await verifyArtifact(pkg, publicKey);
        const module = hydrateModule(moduleContract(pkg.artifact));
        if (
          !Object.values(module.resources).some((r) => r.standalone) &&
          !Object.values(module.operations).some((op) => op.policy === "local")
        )
          throw Error("This module does not support standalone profiles.");
        assertSchema(module.configuration, configuration);
        const prior = data.modules?.[module.id];
        const same = prior?.releases[module.version];
        if (same && same.package.digest !== pkg.digest)
          throw Error(
            "Installed release bytes are immutable. Use a new version for executable changes.",
          );
        const available = new Map(
          availableLocalModules(data).map((m) => [m.id, m]),
        );
        available.set(module.id, module);
        // Check the complete active set: replacing a provider must preserve its consumers.
        const pins = Object.fromEntries(
          [...available.values()].map((m) => [m.id, m.version]),
        );
        for (const item of available.values())
          resolveReleases(
            item.id,
            [...available.values()],
            "1.0.0",
            "1.0.0",
            pins,
          );
        if (
          prior &&
          storageContract(module).version !==
            storageContract(
              moduleContract(prior.releases[prior.version].package.artifact),
            ).version
        )
          throw Error(
            "This local schema upgrade requires a reviewed local migration. Your existing release and data are preserved.",
          );
        for (const [key, rows] of Object.entries(data.records).filter(([key]) =>
          key.startsWith(module.id + "/"),
        )) {
          const resource = module.resources[key.slice(module.id.length + 1)];
          if (rows.length && !resource?.standalone)
            throw Error(
              "The new release cannot read an existing standalone resource.",
            );
          for (const row of rows) assertSchema(resource.schema, row.data);
        }
        await worker.run(
          module,
          {
            profileId: vault.id,
            call: {
              moduleId: module.id,
              moduleVersion: module.version,
              action: "list",
              input: {},
            },
            configuration,
            snapshot: { records: {}, receipts: {} },
          },
          { artifact: { package: pkg, publicKey }, inspect: true },
        );
        await commit({
          ...data,
          modules: {
            ...data.modules,
            [module.id]: {
              active: true,
              version: module.version,
              releases: {
                ...prior?.releases,
                [module.version]: { package: pkg, publicKey, configuration },
              },
            },
          },
        });
      });
    },
    uninstall(moduleId) {
      return enqueue(async () => {
        const prior = data.modules?.[moduleId];
        if (!prior?.active) throw Error("This local module is not installed.");
        if (
          availableLocalModules(data).some(
            (m) => m.id !== moduleId && Object.hasOwn(m.dependencies, moduleId),
          )
        )
          throw Error("Remove dependent local modules first.");
        await commit({
          ...data,
          modules: { ...data.modules, [moduleId]: { ...prior, active: false } },
        });
      });
    },
    execute(module, call, options = {}) {
      module = structuredClone(module);
      call = structuredClone(call);
      options = {
        ...options,
        configuration:
          options.configuration === undefined
            ? undefined
            : structuredClone(options.configuration),
      };
      // Each transaction snapshots after the preceding durable commit.
      const task = tail.then(async () => {
        if (!unlocked)
          throw new LocalExecutionError(
            "PROFILE_LOCKED",
            "Unlock the local profile.",
          );
        const installation = data.modules?.[module.id];
        const release = installation?.releases[module.version];
        if (installation && (!installation.active || !release))
          throw new LocalExecutionError(
            "LOCAL_NOT_INSTALLED",
            "Install this local module release before using it.",
          );
        if (
          installation &&
          installation.version !== module.version &&
          (!call.key ||
            !Object.hasOwn(data.receipts?.[module.id] ?? {}, call.key))
        )
          throw new LocalExecutionError(
            "LOCAL_UPDATE_REQUIRED",
            "Use the active local release for new operations. Historical releases can only recover an existing receipt.",
          );
        const receipt = call.key
          ? data.receipts?.[module.id]?.[call.key]
          : undefined;
        const receiptConfiguration = receipt
          ? JSON.parse(receipt.request).configuration
          : undefined;
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
            configuration:
              options.configuration ??
              receiptConfiguration ??
              release?.configuration ??
              {},
            snapshot,
          },
          {
            ...options,
            artifact: release
              ? { package: release.package, publicKey: release.publicKey }
              : undefined,
          },
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
            ...data,
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
          await commit(next, options.signal);
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

export function installedLocalModules(data: LocalData): ModuleDefinition[] {
  return Object.values(data.modules ?? {})
    .filter((m) => m.active)
    .map((m) =>
      hydrateModule(moduleContract(m.releases[m.version].package.artifact)),
    );
}

/** Bundled defaults and installed releases, excluding explicit removals. */
export function availableLocalModules(data: LocalData): ModuleDefinition[] {
  const available = new Map(moduleDefinitions.map((m) => [m.id, m]));
  for (const [id, installation] of Object.entries(data.modules ?? {}))
    if (!installation.active) available.delete(id);
  for (const module of installedLocalModules(data))
    available.set(module.id, module);
  return [...available.values()];
}
