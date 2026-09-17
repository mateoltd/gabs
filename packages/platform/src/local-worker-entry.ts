import { bundledModuleDefinitions } from "@suite/module-catalog";
import { localModules } from "@suite/module-catalog/local";
import {
  executeLocalCall,
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
// Reviewed application code runs in a dedicated worker, not a hostile-code sandbox.
self.addEventListener(
  "message",
  async (
    event: MessageEvent<{
      module: ModuleDefinition;
      request: LocalRequest;
      artifact?: { package: SignedArtifact; publicKey: string };
      inspect?: boolean;
      migrateFrom?: number;
      migrationSource?: {
        module: ModuleDefinition;
        artifact?: { package: SignedArtifact; publicKey: string };
      };
      referenceArtifacts?: Record<
        string,
        { package: SignedArtifact; publicKey: string }
      >;
    }>,
  ) => {
    try {
      let module: ModuleDefinition | undefined,
        implementation: LocalModule | undefined;
      if (event.data.artifact) {
        const { package: pkg, publicKey } = event.data.artifact;
        await verifyArtifact(pkg, publicKey);
        module = hydrateModule(moduleContract(pkg.artifact));
        if (canonical(module) !== canonical(event.data.module))
          throw Error(
            "The signed local module contract does not match this request.",
          );
        if (
          !satisfies("1.0.0", module.host) ||
          !satisfies("1.0.0", module.backend)
        )
          throw Error("This local release requires a different host version.");
        const bundle = validateLocalArtifact(pkg.artifact);
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
          if (
            !implementation ||
            typeof implementation.execute !== "function" ||
            canonical(implementation.module) !== canonical(module)
          )
            throw Error(
              "The local executable does not implement its signed contract.",
            );
        }
      } else {
        module = bundledModuleDefinitions.find(
          (m) => m.id === event.data.module.id,
        );
        implementation = localModules.find((m) => m.module.id === module?.id);
      }
      if (!module || canonical(module) !== canonical(event.data.module))
        throw Error(
          "The installed local module contract does not match this request.",
        );
      for (const provider of event.data.request.referenceProviders ?? []) {
        const artifact = event.data.referenceArtifacts?.[provider.module.id];
        let verified: ModuleDefinition | undefined;
        if (artifact) {
          await verifyArtifact(artifact.package, artifact.publicKey);
          verified = hydrateModule(moduleContract(artifact.package.artifact));
        } else
          verified = bundledModuleDefinitions.find(
            (candidate) => candidate.id === provider.module.id,
          );
        if (
          !verified ||
          canonical(verified) !== canonical(provider.module) ||
          provider.profileId !== event.data.request.profileId ||
          !satisfies("1.0.0", verified.host) ||
          !satisfies("1.0.0", verified.backend)
        )
          throw Error(
            "The reference provider does not match its verified local release.",
          );
      }
      let source: ModuleDefinition | undefined;
      if (event.data.migrateFrom !== undefined && event.data.migrationSource) {
        const historical = event.data.migrationSource;
        if (historical.artifact) {
          await verifyArtifact(
            historical.artifact.package,
            historical.artifact.publicKey,
          );
          source = hydrateModule(
            moduleContract(historical.artifact.package.artifact),
          );
        } else
          source = bundledModuleDefinitions.find(
            (m) => m.id === historical.module.id,
          );
        if (
          !source ||
          canonical(source) !== canonical(historical.module) ||
          source.id !== module.id
        )
          throw Error(
            "The historical local contract does not match its verified release.",
          );
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
            : await executeLocalCall(
                module,
                event.data.request,
                implementation,
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
