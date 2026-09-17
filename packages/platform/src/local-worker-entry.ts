import { bundledModuleDefinitions } from "@suite/module-catalog";
import { localModules } from "@suite/module-catalog/local";
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
async function verifyDefinition(
  expected: ModuleDefinition,
  artifact?: Artifact,
) {
  let module: ModuleDefinition | undefined;
  if (artifact) {
    await verifyArtifact(artifact.package, artifact.publicKey);
    module = hydrateModule(moduleContract(artifact.package.artifact));
  } else module = bundledModuleDefinitions.find((m) => m.id === expected.id);
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
  } else implementation = localModules.find((m) => m.module.id === module.id);
  if (
    implementation &&
    (typeof implementation.execute !== "function" ||
      canonical(implementation.module) !== canonical(module))
  )
    throw Error("The local executable does not implement its signed contract.");
  return implementation;
}
// Reviewed application code runs in a dedicated worker, not a hostile-code sandbox.
self.addEventListener(
  "message",
  async (
    event: MessageEvent<{
      module: ModuleDefinition;
      request: LocalRequest;
      artifact?: Artifact;
      inspect?: boolean;
      migrateFrom?: number;
      migrationSource?: { module: ModuleDefinition; artifact?: Artifact };
      referenceArtifacts?: Record<string, Artifact>;
      serviceArtifacts?: Record<string, Artifact>;
    }>,
  ) => {
    try {
      const module = await verifyDefinition(
        event.data.module,
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
          event.data.referenceArtifacts?.[provider.module.id],
        );
      }
      let source: ModuleDefinition | undefined;
      if (event.data.migrateFrom !== undefined && event.data.migrationSource) {
        source = await verifyDefinition(
          event.data.migrationSource.module,
          event.data.migrationSource.artifact,
        );
        if (source.id !== module.id)
          throw Error(
            "The historical local contract does not match this module.",
          );
      }
      const implementation = await loadImplementation(
        module,
        event.data.artifact,
      );
      const implementations = implementation ? [implementation] : [];
      if (!event.data.inspect && event.data.migrateFrom === undefined)
        for (const participant of participants) {
          const local = await loadImplementation(
            participant.module,
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
      self.postMessage({ ok: true, value });
    } catch (error) {
      const failure = error as {
        code?: string;
        message?: string;
        detail?: unknown;
      };
      self.postMessage({
        ok: false,
        error: {
          code: failure.code ?? "LOCAL_OPERATION_FAILED",
          message: failure.message ?? "Local operation failed.",
          detail: failure.detail,
        },
      });
    }
  },
);
