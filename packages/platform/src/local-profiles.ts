import { verifyArtifact } from "@suite/module-sdk/verification";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import {
  canonical,
  resolveReleaseSet,
  satisfies,
} from "@suite/module-sdk/registry";
import { referenceFields } from "@suite/module-sdk/references";
import {
  hydrateModule,
  assertSchema,
  localStorageContract,
} from "@suite/module-sdk";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import { bundledModuleDefinitions } from "@suite/module-catalog";
import { openDB } from "idb";
import type {
  ResourceRecord,
  ModuleDefinition,
  ModuleCall,
} from "@suite/module-sdk";
import {
  LocalExecutionError,
  type LocalReceipt,
  type LocalReferenceProvider,
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
export interface LocalDownload {
  rootModuleId: string;
  source: { userId: string; workspaceId: string };
  createdAt: number;
  modules: {
    moduleId: string;
    moduleVersion: string;
    title: string;
    release?: LocalRelease;
  }[];
}
export interface LocalInstallation {
  schemaVersion?: number;
  migrations?: {
    name: string;
    release: string;
    from: number;
    to: number;
    appliedAt: number;
  }[];
  active: boolean;
  version: string;
  releases: Record<string, LocalRelease>;
}
export interface LocalAttempt {
  moduleId: string;
  moduleVersion: string;
  title: string;
  call: ModuleCall;
  configuration: unknown;
  createdAt: number;
  state: "pending" | "accepted" | "rejected" | "interrupted";
  error?: string;
}
export type LocalInstallationAttempt = {
  moduleId: string;
  moduleVersion: string;
  title: string;
  createdAt: number;
  modules?: { moduleId: string; moduleVersion: string; title: string }[];
} & (
  | { state: "accepted" }
  | {
      release: LocalRelease;
      related?: LocalRelease[];
      referenceGrants?: LocalReferenceSelection[];
      state: "pending" | "interrupted" | "failed";
      error?: string;
    }
);
export interface LocalLifecycleEvent {
  id: string;
  action: "installed" | "removed";
  at: number;
  time: "completed" | "requested";
  modules: { moduleId: string; moduleVersion: string; title: string }[];
}
export interface LocalData {
  referenceGrants?: LocalReferenceGrant[];
  lifecycle?: LocalLifecycleEvent[];
  downloads?: Record<string, LocalDownload>;
  installationAttempts?: Record<string, LocalInstallationAttempt>;
  attempts?: Record<string, LocalAttempt>;
  modules?: Record<string, LocalInstallation>;
  records: Record<string, ResourceRecord[]>;
  receipts?: Record<string, Record<string, LocalReceipt>>;
}
export interface LocalReferenceGrant {
  consumerId: string;
  consumerVersion: string;
  providerId: string;
  providerVersion: string;
  resource: string;
  grantedAt: number;
}
export type LocalReferenceSelection = Omit<LocalReferenceGrant, "grantedAt">;
export interface LocalInstallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  referenceGrants?: readonly LocalReferenceSelection[];
}
/** Only declared standalone reference targets are eligible for profile-owner consent. */
export function localReferenceAccess(
  data: LocalData,
  replacements: readonly ModuleDefinition[] = [],
) {
  const available = new Map(availableLocalModules(data).map((m) => [m.id, m]));
  for (const module of replacements) available.set(module.id, module);
  const modules = [...available.values()];
  return modules.flatMap((consumer) => {
    const targets = new Map<
      string,
      { provider: ModuleDefinition; resource: string }
    >();
    for (const definition of Object.values(consumer.resources).filter(
      (r) => r.standalone,
    )) {
      for (const { target } of referenceFields(definition.schema)) {
        if (target.kind !== "resource" || target.moduleId === consumer.id)
          continue;
        const provider = modules.find((m) => m.id === target.moduleId);
        const range = consumer.dependencies[target.moduleId];
        if (
          !provider ||
          !range ||
          !satisfies(provider.version, range) ||
          !provider.resources[target.resource]?.standalone ||
          !provider.permissions.includes(
            `${provider.id}.${target.resource}.read`,
          )
        )
          continue;
        targets.set(`${provider.id}/${target.resource}`, {
          provider,
          resource: target.resource,
        });
      }
    }
    return [...targets.values()].map(({ provider, resource }) => ({
      consumer,
      provider,
      resource,
      granted: !!data.referenceGrants?.some(
        (grant) =>
          grant.consumerId === consumer.id &&
          grant.consumerVersion === consumer.version &&
          grant.providerId === provider.id &&
          grant.providerVersion === provider.version &&
          grant.resource === resource,
      ),
    }));
  });
}
function referenceContext(
  data: LocalData,
  module: ModuleDefinition,
  profileId: string,
) {
  const referenceProviders: LocalReferenceProvider[] = [];
  const referenceArtifacts: Record<
    string,
    { package: SignedArtifact; publicKey: string }
  > = {};
  for (const access of localReferenceAccess(data).filter(
    (access) =>
      access.granted &&
      access.consumer.id === module.id &&
      access.consumer.version === module.version,
  )) {
    let provider = referenceProviders.find(
      (entry) => entry.module.id === access.provider.id,
    );
    if (!provider) {
      provider = {
        profileId,
        module: access.provider,
        resources: [],
        records: {},
      };
      referenceProviders.push(provider);
      const installed = data.modules?.[access.provider.id];
      const providerRelease = installed?.releases[installed.version];
      if (providerRelease)
        referenceArtifacts[access.provider.id] = {
          package: providerRelease.package,
          publicKey: providerRelease.publicKey,
        };
    }
    provider.resources.push(access.resource);
    provider.records[access.resource] =
      data.records[`${access.provider.id}/${access.resource}`] ?? [];
  }
  return { referenceProviders, referenceArtifacts };
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
  setReferenceAccess(
    consumerId: string,
    providerId: string,
    resource: string,
    allowed: boolean,
  ): Promise<void>;
  beginDownload(
    rootModuleId: string,
    source: LocalDownload["source"],
    modules: readonly Pick<ModuleDefinition, "id" | "version" | "name">[],
  ): Promise<string>;
  saveDownload(
    id: string,
    pkg: SignedArtifact,
    publicKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  dismissDownload(id: string): Promise<void>;
  installDownload(
    id: string,
    configuration: Record<string, unknown>,
    options?: LocalInstallOptions,
  ): Promise<void>;
  /** The host supplies the official registry trust key, never a key from the package. */
  install(
    pkg: SignedArtifact,
    publicKey: string,
    configuration?: unknown,
    options?: LocalInstallOptions,
  ): Promise<void>;
  installSet(
    rootModuleId: string,
    releases: readonly LocalRelease[],
    options?: LocalInstallOptions,
  ): Promise<void>;
  retryInstallation(
    attemptId: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<void>;
  dismissInstallation(attemptId: string): Promise<void>;
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
  retry(
    attemptId: string,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  dismiss(attemptId: string): Promise<void>;
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
  async function assertCurrentProfile() {
    unlockedOrThrow();
    const stored = (await (await db()).get("vaults", vault.id)) as
      Vault | undefined;
    unlockedOrThrow();
    if (!stored || (stored.revision ?? 0) !== revision)
      throw new LocalExecutionError(
        "PROFILE_CHANGED",
        "This profile changed in another window or was removed. Unlock it again before using module access.",
      );
  }
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
  async function installReleaseSet(
    rootModuleId: string,
    releases: readonly LocalRelease[],
    options: LocalInstallOptions,
    downloadId?: string,
  ) {
    if (!releases.length || releases.length > 100)
      throw Error("Choose between one and 100 local module releases.");
    const selected = new Map<
      string,
      { module: ModuleDefinition; release: LocalRelease }
    >();
    for (const release of releases) {
      await verifyArtifact(release.package, release.publicKey);
      const module = hydrateModule(moduleContract(release.package.artifact));
      if (selected.has(module.id))
        throw Error(
          "A local installation set cannot contain duplicate modules.",
        );
      if (
        !Object.values(module.resources).some((r) => r.standalone) &&
        !Object.values(module.operations).some((op) => op.policy === "local")
      )
        throw Error(`${module.name} does not support standalone profiles.`);
      assertSchema(module.configuration, release.configuration);
      if (
        Object.values(data.attempts ?? {}).some(
          (a) =>
            a.moduleId === module.id &&
            a.state !== "accepted" &&
            (a.moduleVersion !== module.version ||
              canonical(a.configuration) !== canonical(release.configuration)),
        )
      )
        throw Error(
          "Resolve or dismiss pending local requests before changing this module's release or configuration. Their input is preserved.",
        );
      const same = data.modules?.[module.id]?.releases[module.version];
      if (same && same.package.digest !== release.package.digest)
        throw Error(
          "Installed release bytes are immutable. Use a new version for executable changes.",
        );
      selected.set(module.id, { module, release });
    }
    const root = selected.get(rootModuleId);
    if (!root)
      throw Error(
        "The installation set must include its requested root module.",
      );
    const available = new Map(
      availableLocalModules(data).map((m) => [m.id, m]),
    );
    for (const { module } of selected.values())
      available.set(module.id, module);
    const pins = Object.fromEntries(
      [...available.values()].map((m) => [m.id, m.version]),
    );
    const ordered = resolveReleaseSet(
      [...available.keys()],
      [...available.values()],
      "1.0.0",
      "1.0.0",
      pins,
    ).filter((m) => selected.has(m.id));
    const choices = localReferenceAccess(
      data,
      [...selected.values()].map(({ module }) => module),
    );
    const decisions = options.referenceGrants ?? [];
    if (!Array.isArray(decisions) || decisions.length > 1000)
      throw Error("Choose at most 1000 declared reference grants.");
    const referenceGrants: LocalReferenceSelection[] = [];
    for (const decision of decisions) {
      const choice = choices.find(
        ({ consumer, provider, resource }) =>
          decision &&
          consumer.id === decision.consumerId &&
          consumer.version === decision.consumerVersion &&
          provider.id === decision.providerId &&
          provider.version === decision.providerVersion &&
          resource === decision.resource &&
          (selected.has(consumer.id) || selected.has(provider.id)),
      );
      if (!choice)
        throw Error(
          "Reference consent must match the reviewed module releases and a declared standalone resource.",
        );
      const normalized = {
        consumerId: choice.consumer.id,
        consumerVersion: choice.consumer.version,
        providerId: choice.provider.id,
        providerVersion: choice.provider.version,
        resource: choice.resource,
      };
      if (
        referenceGrants.some(
          (item) => canonical(item) === canonical(normalized),
        )
      )
        throw Error("Reference consent cannot contain duplicate resources.");
      referenceGrants.push(normalized);
    }
    referenceGrants.sort((a, b) => canonical(a).localeCompare(canonical(b)));
    const normalized = [...releases].sort((a, b) =>
      a.package.module_id.localeCompare(b.package.module_id),
    );
    const overlaps = Object.entries(data.installationAttempts ?? {}).filter(
      ([, attempt]) =>
        attempt.state !== "accepted" &&
        (attempt.modules ?? [attempt]).some((m) => selected.has(m.moduleId)),
    );
    const unfinished = overlaps[0];
    if (
      overlaps.length > 1 ||
      (unfinished &&
        unfinished[1].state !== "accepted" &&
        (unfinished[1].moduleId !== rootModuleId ||
          canonical(
            [unfinished[1].release, ...(unfinished[1].related ?? [])].sort(
              (a, b) => a.package.module_id.localeCompare(b.package.module_id),
            ),
          ) !== canonical(normalized) ||
          canonical(unfinished[1].referenceGrants ?? []) !==
            canonical(referenceGrants)))
    )
      throw Error(
        "Resume or discard the unfinished installation before selecting another release or configuration. Your installed modules and records are preserved.",
      );
    const attemptId = unfinished?.[0] ?? crypto.randomUUID();
    const metadata = {
      moduleId: rootModuleId,
      moduleVersion: root.module.version,
      title: root.module.name,
      modules: ordered.map((m) => ({
        moduleId: m.id,
        moduleVersion: m.version,
        title: selected.get(m.id)!.module.name,
      })),
      createdAt: unfinished?.[1].createdAt ?? Date.now(),
    };
    const attempt: LocalInstallationAttempt = {
      ...metadata,
      release: root.release,
      related: normalized.filter((r) => r.package.module_id !== rootModuleId),
      referenceGrants,
      state: "pending",
    };
    const downloads = { ...data.downloads };
    if (downloadId) delete downloads[downloadId];
    await commit(
      {
        ...data,
        downloads,
        installationAttempts: {
          ...data.installationAttempts,
          [attemptId]: attempt,
        },
      },
      options.signal,
    );
    try {
      let next: LocalData = {
        ...data,
        records: { ...data.records },
        modules: { ...data.modules },
        referenceGrants: [
          ...(data.referenceGrants ?? []).filter(
            (prior) =>
              !referenceGrants.some(
                (grant) =>
                  grant.consumerId === prior.consumerId &&
                  grant.providerId === prior.providerId &&
                  grant.resource === prior.resource,
              ),
          ),
          ...referenceGrants.map((grant) => ({
            ...grant,
            grantedAt: Date.now(),
          })),
        ],
      };
      // Stage verified definitions for eligibility; dependency order supplies migrated provider records.
      for (const { module, release } of selected.values()) {
        const prior = data.modules?.[module.id];
        next.modules![module.id] = {
          ...prior,
          active: true,
          version: module.version,
          releases: { ...prior?.releases, [module.version]: release },
        };
      }
      for (const choice of ordered) {
        const { module, release } = selected.get(choice.id)!;
        const { package: pkg, publicKey, configuration } = release;
        const prior = data.modules?.[module.id];
        const prefix = module.id + "/";
        const records = Object.fromEntries(
          Object.entries(data.records)
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, rows]) => [key.slice(prefix.length), rows]),
        );
        const fromVersion = localSchemaVersion(data, module);
        const previous = prior?.releases[prior.version];
        const source = previous
          ? hydrateModule(moduleContract(previous.package.artifact))
          : bundledModuleDefinitions.find((m) => m.id === module.id);
        const { referenceProviders, referenceArtifacts } = referenceContext(
          next,
          module,
          vault.id,
        );
        const migrated = await worker.run(
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
            snapshot: { records, receipts: data.receipts?.[module.id] ?? {} },
            referenceProviders,
          },
          {
            ...options,
            artifact: { package: pkg, publicKey },
            migrateFrom: fromVersion,
            referenceArtifacts,
            migrationSource: source
              ? {
                  module: source,
                  ...(previous
                    ? {
                        artifact: {
                          package: previous.package,
                          publicKey: previous.publicKey,
                        },
                      }
                    : {}),
                }
              : undefined,
          },
        );
        let migratedFrom = fromVersion;
        const history = (migrated.migrations ?? []).map((name) => {
          const to = localStorageContract(module).migrations[name].to;
          const entry = {
            name,
            release: module.version,
            from: migratedFrom,
            to,
            appliedAt: Date.now(),
          };
          migratedFrom = to;
          return entry;
        });
        next = {
          ...next,
          records: {
            ...Object.fromEntries(
              Object.entries(next.records).filter(
                ([key]) => !key.startsWith(prefix),
              ),
            ),
            ...Object.fromEntries(
              Object.entries(migrated.snapshot.records).map(([key, rows]) => [
                prefix + key,
                rows,
              ]),
            ),
          },
          modules: {
            ...next.modules,
            [module.id]: {
              schemaVersion: migrated.schemaVersion,
              migrations: [...(prior?.migrations ?? []), ...history],
              active: true,
              version: module.version,
              releases: { ...prior?.releases, [module.version]: release },
            },
          },
        };
      }
      await commit(
        {
          ...next,
          lifecycle: [
            ...(data.lifecycle ?? []),
            {
              id: attemptId,
              action: "installed",
              at: Date.now(),
              time: "completed",
              modules: metadata.modules,
            },
          ],
          installationAttempts: {
            ...data.installationAttempts,
            [attemptId]: { ...metadata, state: "accepted" },
          },
        },
        options.signal,
      );
    } catch (error) {
      if (
        unlocked &&
        data.installationAttempts?.[attemptId]?.state === "pending"
      ) {
        const interrupted = [
          "LOCAL_CANCELLED",
          "LOCAL_TIMEOUT",
          "LOCAL_WORKER_FAILED",
          "PROFILE_LOCKED",
          "PROFILE_CHANGED",
        ].includes((error as { code?: string }).code ?? "");
        // A storage failure must preserve the original durable request and original error.
        await commit({
          ...data,
          installationAttempts: {
            ...data.installationAttempts,
            [attemptId]: {
              ...attempt,
              state: interrupted ? "interrupted" : "failed",
              error:
                error instanceof Error
                  ? error.message
                  : "The installation could not finish.",
            },
          },
        }).catch(() => {});
      }
      throw error;
    }
  }
  const current: LocalSession = {
    setReferenceAccess(consumerId, providerId, resource, allowed) {
      return enqueue(async () => {
        if (
          typeof allowed !== "boolean" ||
          [consumerId, providerId, resource].some(
            (value) =>
              typeof value !== "string" ||
              !/^[a-z][a-z0-9-]{0,63}$/.test(value),
          )
        )
          throw Error(
            "Choose valid modules, a resource and an explicit access decision.",
          );
        const candidate = localReferenceAccess(data).find(
          (item) =>
            item.consumer.id === consumerId &&
            item.provider.id === providerId &&
            item.resource === resource,
        );
        if (allowed && !candidate)
          throw Error(
            "Choose a declared reference between installed standalone modules.",
          );
        const grants = (data.referenceGrants ?? []).filter(
          (grant) =>
            !(
              grant.consumerId === consumerId &&
              grant.providerId === providerId &&
              grant.resource === resource
            ),
        );
        if (allowed && candidate)
          grants.push({
            consumerId,
            consumerVersion: candidate.consumer.version,
            providerId,
            providerVersion: candidate.provider.version,
            resource,
            grantedAt: Date.now(),
          });
        const installationAttempts = Object.fromEntries(
          Object.entries(data.installationAttempts ?? {}).map(
            ([id, attempt]) => [
              id,
              !allowed && attempt.state !== "accepted"
                ? {
                    ...attempt,
                    referenceGrants: attempt.referenceGrants?.filter(
                      (grant) =>
                        !(
                          grant.consumerId === consumerId &&
                          grant.providerId === providerId &&
                          grant.resource === resource
                        ),
                    ),
                  }
                : attempt,
            ],
          ),
        );
        await commit({
          ...data,
          referenceGrants: grants,
          installationAttempts,
        });
      });
    },
    id: vault.id,
    name: vault.name,
    get data() {
      return structuredClone(data);
    },
    beginDownload(rootModuleId, source, modules) {
      const planned: LocalDownload = {
        rootModuleId,
        source: { ...source },
        createdAt: Date.now(),
        modules: modules.map((m) => ({
          moduleId: m.id,
          moduleVersion: m.version,
          title: m.name,
        })),
      };
      return enqueue(async () => {
        if (
          !planned.source.userId ||
          !planned.source.workspaceId ||
          !planned.modules.length ||
          planned.modules.length > 100 ||
          !planned.modules.some((m) => m.moduleId === rootModuleId) ||
          new Set(planned.modules.map((m) => m.moduleId)).size !==
            planned.modules.length
        )
          throw Error(
            "Choose a valid local download set with its source account and workspace.",
          );
        const existing = Object.entries(data.downloads ?? {}).find(
          ([, d]) => d.rootModuleId === rootModuleId,
        );
        if (existing) {
          const selection = (d: LocalDownload) =>
            canonical({
              source: d.source,
              modules: d.modules
                .map((m) => [m.moduleId, m.moduleVersion])
                .sort(([a], [b]) => a.localeCompare(b)),
            });
          if (selection(existing[1]) !== selection(planned))
            throw Error(
              "Resume or discard the saved download before choosing another release or account.",
            );
          return existing[0];
        }
        const id = crypto.randomUUID();
        await commit({
          ...data,
          downloads: { ...data.downloads, [id]: planned },
        });
        return id;
      });
    },
    saveDownload(id, pkg, publicKey, options = {}) {
      const candidate = structuredClone(pkg),
        signal = options.signal;
      return enqueue(async () => {
        const download = data.downloads?.[id];
        if (!download)
          throw Error("This saved download is no longer available.");
        await verifyArtifact(candidate, publicKey);
        const module = hydrateModule(moduleContract(candidate.artifact));
        const expected = download.modules.find((m) => m.moduleId === module.id);
        if (!expected || expected.moduleVersion !== module.version)
          throw Error(
            "The available release changed during download. Discard this download and browse personal modules again.",
          );
        if (
          !Object.values(module.resources).some((r) => r.standalone) &&
          !Object.values(module.operations).some((op) => op.policy === "local")
        )
          throw Error("This module does not support standalone local work.");
        if (expected.release) {
          if (
            canonical(expected.release.package) !== canonical(candidate) ||
            expected.release.publicKey !== publicKey
          )
            throw Error(
              "Saved release bytes are immutable. Discard the download before selecting different bytes or a signing key.",
            );
          return;
        }
        const installed = data.modules?.[module.id];
        const release: LocalRelease = {
          package: candidate,
          publicKey,
          configuration:
            installed?.releases[module.version]?.configuration ??
            installed?.releases[installed.version]?.configuration ??
            {},
        };
        await commit(
          {
            ...data,
            downloads: {
              ...data.downloads,
              [id]: {
                ...download,
                modules: download.modules.map((m) =>
                  m === expected ? { ...m, release } : m,
                ),
              },
            },
          },
          signal,
        );
      });
    },
    dismissDownload(id) {
      return enqueue(async () => {
        const downloads = { ...data.downloads };
        delete downloads[id];
        await commit({ ...data, downloads });
      });
    },
    installDownload(id, configuration, options = {}) {
      const configurations = structuredClone(configuration),
        execution = {
          ...options,
          referenceGrants: structuredClone(options.referenceGrants),
        };
      return enqueue(async () => {
        const download = data.downloads?.[id];
        if (!download || download.modules.some((m) => !m.release))
          throw Error(
            "Finish downloading all required releases before installing.",
          );
        const releases = download.modules.map((m) => ({
          ...m.release!,
          configuration: configurations[m.moduleId] ?? m.release!.configuration,
        }));
        // Download removal and the recoverable installation attempt commit together.
        await installReleaseSet(download.rootModuleId, releases, execution, id);
      });
    },
    install(pkg, publicKey, configuration = {}, options = {}) {
      const release = structuredClone({
        package: pkg,
        publicKey,
        configuration,
      });
      const execution = {
        ...options,
        referenceGrants: structuredClone(options.referenceGrants),
      };
      return enqueue(() =>
        installReleaseSet(release.package.module_id, [release], execution),
      );
    },
    installSet(rootModuleId, releases, options = {}) {
      const candidates = structuredClone(releases);
      const execution = {
        ...options,
        referenceGrants: structuredClone(options.referenceGrants),
      };
      return enqueue(() =>
        installReleaseSet(rootModuleId, candidates, execution),
      );
    },
    retryInstallation(attemptId, options = {}) {
      const execution = { ...options };
      return enqueue(async () => {
        const attempt = data.installationAttempts?.[attemptId];
        if (!attempt)
          throw Error("This installation request is no longer available.");
        // The acceptance marker commits with the release and data. Never replay an old install.
        if (attempt.state === "accepted") return;
        await installReleaseSet(
          attempt.moduleId,
          [attempt.release, ...(attempt.related ?? [])],
          { ...execution, referenceGrants: attempt.referenceGrants },
        );
      });
    },
    dismissInstallation(attemptId) {
      return enqueue(async () => {
        const installationAttempts = { ...data.installationAttempts };
        delete installationAttempts[attemptId];
        await commit({ ...data, installationAttempts });
      });
    },
    uninstall(moduleId) {
      return enqueue(async () => {
        if (
          Object.values(data.installationAttempts ?? {}).some(
            (attempt) =>
              attempt.state !== "accepted" &&
              (attempt.modules ?? [attempt]).some(
                (m) => m.moduleId === moduleId,
              ),
          )
        )
          throw Error(
            "Resume or discard the unfinished installation before removing this module. Its records are preserved.",
          );
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
          lifecycle: [
            ...(data.lifecycle ?? []),
            {
              id: crypto.randomUUID(),
              action: "removed",
              at: Date.now(),
              time: "completed",
              modules: [
                {
                  moduleId,
                  moduleVersion: prior.version,
                  title: String(
                    prior.releases[prior.version].package.artifact.name,
                  ),
                },
              ],
            },
          ],
          modules: { ...data.modules, [moduleId]: { ...prior, active: false } },
          referenceGrants: data.referenceGrants?.filter(
            (grant) =>
              grant.consumerId !== moduleId && grant.providerId !== moduleId,
          ),
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
        await assertCurrentProfile();
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
        const configuration =
          options.configuration ??
          receiptConfiguration ??
          release?.configuration ??
          {};
        const attemptId =
          call.action === "operation" && call.key
            ? module.id + "/" + call.key
            : undefined;
        const previous = attemptId ? data.attempts?.[attemptId] : undefined;
        if (
          previous &&
          (canonical(previous.call) !== canonical(call) ||
            canonical(previous.configuration) !== canonical(configuration))
        )
          throw new LocalExecutionError(
            "IDEMPOTENCY_CONFLICT",
            "This request identifier belongs to different input. Recover the original request or start a new operation.",
          );
        if (
          call.action === "operation" &&
          module.operations[call.operation!]?.policy !== "local"
        )
          throw new LocalExecutionError(
            "LOCAL_ONLY",
            "This operation requires server execution.",
          );
        if (attemptId && !receipt) {
          await commit(
            {
              ...data,
              attempts: {
                ...data.attempts,
                [attemptId]: {
                  moduleId: module.id,
                  moduleVersion: module.version,
                  title: module.operations[call.operation!].title,
                  call,
                  configuration,
                  createdAt: previous?.createdAt ?? Date.now(),
                  state: "pending",
                },
              },
            },
            options.signal,
          );
        }
        const prefix = module.id + "/";
        const { referenceProviders, referenceArtifacts } = referenceContext(
          data,
          module,
          vault.id,
        );
        const snapshot = {
          records: Object.fromEntries(
            Object.entries(data.records)
              .filter(([name]) => name.startsWith(prefix))
              .map(([name, rows]) => [name.slice(prefix.length), rows]),
          ),
          receipts: data.receipts?.[module.id] ?? {},
        };
        try {
          const result = await worker.run(
            module,
            {
              profileId: vault.id,
              call,
              configuration,
              snapshot,
              referenceProviders,
            },
            {
              ...options,
              referenceArtifacts,
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
          await assertCurrentProfile();
          if (options.signal?.aborted)
            throw new LocalExecutionError(
              "LOCAL_CANCELLED",
              "The local operation was cancelled.",
            );
          if (!["get", "list", "references"].includes(call.action)) {
            const next: LocalData = {
              ...data,
              ...(attemptId && data.attempts?.[attemptId]
                ? {
                    attempts: {
                      ...data.attempts,
                      [attemptId]: {
                        ...data.attempts[attemptId],
                        state: "accepted",
                        error: undefined,
                      },
                    },
                  }
                : {}),
              records: {
                ...data.records,
                ...Object.fromEntries(
                  Object.entries(result.snapshot.records).map(
                    ([name, rows]) => [prefix + name, rows],
                  ),
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
        } catch (error) {
          if (
            attemptId &&
            unlocked &&
            data.attempts?.[attemptId]?.state === "pending"
          ) {
            const code = (error as { code?: string }).code;
            const rejected = [
              "MODULE_BUSINESS_ERROR",
              "INVALID_INPUT",
              "VERSION_CONFLICT",
              "NOT_FOUND",
              "RECORD_ARCHIVED",
              "APPEND_ONLY",
              "LOCAL_ONLY",
              "LOCAL_SCOPE_DENIED",
              "IDEMPOTENCY_CONFLICT",
              "INVALID_LOCAL_ACTION",
            ].includes(code ?? "");
            // Preserve pending input if storage itself fails. Never conceal the original error.
            await commit({
              ...data,
              attempts: {
                ...data.attempts,
                [attemptId]: {
                  ...data.attempts[attemptId],
                  state: rejected ? "rejected" : "interrupted",
                  error:
                    error instanceof Error
                      ? error.message
                      : "The local operation could not finish.",
                },
              },
            }).catch(() => {});
          }
          throw error;
        }
      });
      tail = task.catch(() => {});
      return task;
    },
    retry(attemptId, options) {
      const attempt = data.attempts?.[attemptId];
      if (!attempt)
        return Promise.reject(
          Error("This local request is no longer available."),
        );
      const release =
        data.modules?.[attempt.moduleId]?.releases[attempt.moduleVersion];
      const module = release
        ? hydrateModule(moduleContract(release.package.artifact))
        : bundledModuleDefinitions.find(
            (m) =>
              m.id === attempt.moduleId && m.version === attempt.moduleVersion,
          );
      if (!module)
        return Promise.reject(
          Error(
            "Restore this request's module release before retrying. Its input is preserved.",
          ),
        );
      return current.execute(module, attempt.call, {
        ...options,
        configuration: attempt.configuration,
      });
    },
    dismiss(attemptId) {
      return enqueue(async () => {
        const attempts = { ...data.attempts };
        delete attempts[attemptId];
        await commit({ ...data, attempts });
      });
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
  const available = new Map(bundledModuleDefinitions.map((m) => [m.id, m]));
  for (const [id, installation] of Object.entries(data.modules ?? {}))
    if (!installation.active) available.delete(id);
  for (const module of installedLocalModules(data))
    available.set(module.id, module);
  return [...available.values()];
}

/** Plan against every active consumer, preferring its existing release unless dependencies require a change. */
export function planLocalInstallation(
  data: LocalData,
  root: ModuleDefinition,
  registry: readonly ModuleDefinition[],
) {
  const issue = localReleaseIssue(data, root);
  if (issue) throw Error(issue);
  const installed = availableLocalModules(data);
  const candidates = new Map(installed.map((m) => [m.id + "@" + m.version, m]));
  for (const module of [...registry, root])
    candidates.set(module.id + "@" + module.version, module);
  const selected = resolveReleaseSet(
    [...new Set([root.id, ...installed.map((m) => m.id)])],
    [...candidates.values()].filter((m) => !localReleaseIssue(data, m)),
    "1.0.0",
    "1.0.0",
    { [root.id]: root.version },
    Object.fromEntries(installed.map((m) => [m.id, m.version])),
  );
  return selected
    .filter(
      (m) =>
        m.id === root.id ||
        !installed.some((old) => old.id === m.id && old.version === m.version),
    )
    .map((m) => candidates.get(m.id + "@" + m.version)!);
}

/** The same starting schema is used by planning and the authoritative local worker. */
export function localSchemaVersion(data: LocalData, module: ModuleDefinition) {
  const prior = data.modules?.[module.id];
  const previous = prior
    ? moduleContract(prior.releases[prior.version].package.artifact)
    : bundledModuleDefinitions.find((m) => m.id === module.id);
  return (
    prior?.schemaVersion ??
    (previous
      ? localStorageContract(previous).version
      : Object.entries(data.records).some(
            ([key, rows]) => key.startsWith(module.id + "/") && rows.length,
          )
        ? 1
        : localStorageContract(module).version)
  );
}

/** Metadata preflight only. Signed worker execution still validates every record and migration. */
export function localReleaseIssue(
  data: LocalData,
  module: ModuleDefinition,
): string | undefined {
  const contract = localStorageContract(module);
  let version = localSchemaVersion(data, module);
  while (version < contract.version) {
    const step = Object.values(contract.migrations).find(
      (m) => m.from === version,
    );
    if (!step || step.to !== version + 1)
      return `${module.name} ${module.version} does not include a migration from local data version ${version} to ${version + 1}.`;
    version = step.to;
  }
  if (
    version < contract.compatible.minimum ||
    version > contract.compatible.maximum
  )
    return `${module.name} ${module.version} cannot use local data version ${version}. Choose a release compatible with the saved data.`;
}

export function planRetainedLocalInstallation(
  data: LocalData,
  moduleId: string,
  version: string,
): LocalRelease[] {
  const releases = Object.values(data.modules ?? {}).flatMap((m) =>
    Object.values(m.releases),
  );
  const root = data.modules?.[moduleId]?.releases[version];
  if (!root) throw Error("This release is not retained in this local profile.");
  return planLocalInstallation(
    data,
    hydrateModule(moduleContract(root.package.artifact)),
    releases.map((r) => hydrateModule(moduleContract(r.package.artifact))),
  ).map((m) => {
    const release = releases.find(
      (r) => r.package.module_id === m.id && r.package.version === m.version,
    );
    if (!release)
      throw Error(`Download ${m.name} ${m.version} before continuing.`);
    return release;
  });
}

/** Older accepted attempts retain their known request time; no completion date is invented. */
export function localLifecycleHistory(data: LocalData): LocalLifecycleEvent[] {
  const events = [...(data.lifecycle ?? [])].reverse();
  const recorded = new Set(events.map((e) => e.id));
  for (const [id, attempt] of Object.entries(data.installationAttempts ?? {}))
    if (attempt.state === "accepted" && !recorded.has(id))
      events.push({
        id,
        action: "installed",
        at: attempt.createdAt,
        time: "requested",
        modules: attempt.modules ?? [
          {
            moduleId: attempt.moduleId,
            moduleVersion: attempt.moduleVersion,
            title: attempt.title,
          },
        ],
      });
  return events.sort((a, b) => b.at - a.at);
}
