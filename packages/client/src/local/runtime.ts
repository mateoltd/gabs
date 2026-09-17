import {
  executeLocalTransaction,
  migrateLocalSnapshot,
  type LocalRequest,
  type LocalModule,
} from "@suite/module-sdk/local";
import { canonical, satisfies } from "@suite/module-sdk/registry";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import { verifyArtifact } from "@suite/module-sdk/verification";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import { validateLocalArtifact } from "@suite/module-sdk/local-artifact";
import type { SignedArtifact } from "@suite/module-sdk/platform";
type Artifact = { package: SignedArtifact; publicKey: string };
export interface LocalWorkerComposition {
  bundledModules: readonly ModuleDefinition[];
  implementations: readonly LocalModule[];
}

export interface LocalWorkerMessage {
  module: ModuleDefinition;
  request: LocalRequest;
  artifact?: Artifact;
  inspect?: boolean;
  migrateFrom?: number;
  migrationSource?: { module: ModuleDefinition; artifact?: Artifact };
  referenceArtifacts?: Record<string, Artifact>;
  serviceArtifacts?: Record<string, Artifact>;
}

export interface LocalWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<LocalWorkerMessage>) => void,
  ): void;
  postMessage(message: unknown): void;
}

async function verifyDefinition(
  expected: ModuleDefinition,
  composition: LocalWorkerComposition,
  artifact?: Artifact,
) {
  let module: ModuleDefinition | undefined;
  if (artifact) {
    await verifyArtifact(artifact.package, artifact.publicKey);
    module = hydrateModule(moduleContract(artifact.package.artifact));
  } else module = composition.bundledModules.find((m) => m.id === expected.id);
  if (!module || canonical(module) !== canonical(expected))
    throw Error(
      "The installed local module contract does not match its verified release.",
    );
  if (!satisfies("1.0.0", module.host) || !satisfies("1.0.0", module.backend))
    throw Error("This local release requires a different host version.");
  return module;
}
async function loadImplementation(
  module: ModuleDefinition,
  composition: LocalWorkerComposition,
  artifact?: Artifact,
) {
  let implementation: LocalModule | undefined;
  if (artifact) {
    const bundle = validateLocalArtifact(artifact.package.artifact);
    if (bundle) {
      const url = URL.createObjectURL(
        new Blob([bundle.javascript], { type: "text/javascript" }),
      );
      try {
        implementation = (await import(/* @vite-ignore */ url))
          .default as LocalModule;
      } finally {
        URL.revokeObjectURL(url);
      }
      if (!implementation)
        throw Error(
          "The local executable does not implement its signed contract.",
        );
    }
  } else
    implementation = composition.implementations.find(
      (candidate) => candidate.module.id === module.id,
    );
  if (
    implementation &&
    (typeof implementation.execute !== "function" ||
      canonical(implementation.module) !== canonical(module))
  )
    throw Error("The local executable does not implement its signed contract.");
  return implementation;
}
export function createLocalWorkerHandler(
  scope: Pick<LocalWorkerScope, "postMessage">,
  composition: LocalWorkerComposition,
) {
  return async (event: MessageEvent<LocalWorkerMessage>) => {
    try {
      const module = await verifyDefinition(
        event.data.module,
        composition,
        event.data.artifact,
      );
      const participants = event.data.request.serviceParticipants ?? [];
      const seen = new Set([module.id]);
      for (const participant of participants) {
        if (
          participant.profileId !== event.data.request.profileId ||
          seen.has(participant.module.id)
        )
          throw Error(
            "Service participants must be unique modules in the same profile.",
          );
        seen.add(participant.module.id);
        await verifyDefinition(
          participant.module,
          composition,
          event.data.serviceArtifacts?.[participant.module.id],
        );
      }
      for (const provider of [event.data.request, ...participants].flatMap(
        (r) => r.referenceProviders ?? [],
      )) {
        if (provider.profileId !== event.data.request.profileId)
          throw Error(
            "The reference provider does not belong to this profile.",
          );
        await verifyDefinition(
          provider.module,
          composition,
          event.data.referenceArtifacts?.[provider.module.id],
        );
      }
      let source: ModuleDefinition | undefined;
      if (event.data.migrateFrom !== undefined && event.data.migrationSource) {
        source = await verifyDefinition(
          event.data.migrationSource.module,
          composition,
          event.data.migrationSource.artifact,
        );
        if (source.id !== module.id)
          throw Error(
            "The historical local contract does not match this module.",
          );
      }
      const implementation = await loadImplementation(
        module,
        composition,
        event.data.artifact,
      );
      const implementations = implementation ? [implementation] : [];
      if (!event.data.inspect && event.data.migrateFrom === undefined)
        for (const participant of participants) {
          const local = await loadImplementation(
            participant.module,
            composition,
            event.data.serviceArtifacts?.[participant.module.id],
          );
          if (local) implementations.push(local);
        }
      const value =
        event.data.migrateFrom !== undefined
          ? await migrateLocalSnapshot(
              module,
              event.data.request,
              event.data.migrateFrom,
              implementation,
              source,
            )
          : event.data.inspect
            ? { result: null, snapshot: event.data.request.snapshot }
            : await executeLocalTransaction(
                module,
                event.data.request,
                implementations,
              );
      scope.postMessage({ ok: true, value });
    } catch (error) {
      const failure = error as {
        code?: string;
        message?: string;
        detail?: unknown;
      };
      scope.postMessage({
        ok: false,
        error: {
          code: failure.code ?? "LOCAL_OPERATION_FAILED",
          message: failure.message ?? "Local operation failed.",
          detail: failure.detail,
        },
      });
    }
  };
}

/** Reviewed application code runs in a dedicated worker, not a hostile-code sandbox. */
export function installLocalWorker(
  scope: LocalWorkerScope,
  composition: LocalWorkerComposition,
) {
  scope.addEventListener(
    "message",
    createLocalWorkerHandler(scope, composition),
  );
}
