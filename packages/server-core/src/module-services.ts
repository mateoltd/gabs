import { assertModuleStorage } from "./module-storage";
import { assertSchema, type ModuleDefinition } from "@suite/module-sdk";
import { canonical, satisfies } from "@suite/module-sdk/registry";
import {
  ModuleBusinessError,
  type ScopedModuleServer,
  type TrustedModuleServer,
} from "@suite/module-sdk/server";
import type { Tx } from "./database";
import { authorize, type Context } from "./authorization";
import { found, requireCondition } from "./errors";
import { workspaceModule } from "./module-releases";
import { executeResource, type ResourceCommand } from "./module-runtime";
import { audit, publish } from "./transactions";
import { stagedModuleServer } from "./staged-module-server";
export type InstalledModuleServer =
  ScopedModuleServer | TrustedModuleServer<{ tx: Tx; ctx: Context }>;

/** All capabilities share the caller's transaction and current server identity. */
export async function executeModuleOperation(
  tx: Tx,
  initialContext: Context,
  definition: ModuleDefinition,
  operationName: string,
  input: unknown,
  servers: readonly InstalledModuleServer[],
): Promise<unknown> {
  const invoke = async (
    module: ModuleDefinition,
    name: string,
    value: unknown,
    active: string[] = [],
  ): Promise<unknown> => {
    const operation = found(module.operations[name]);
    const ctx = await authorize(
      tx,
      initialContext.actor,
      initialContext.workspaceId,
      initialContext.requestId,
      operation.permission,
      module.id,
    );
    await assertModuleStorage(tx, ctx.workspaceId, module);
    requireCondition(
      operation.policy !== "local",
      400,
      "LOCAL_ONLY",
      "This operation belongs to a local workspace.",
    );
    const identity = `${module.id}.${name}`;
    requireCondition(
      !active.includes(identity) && active.length < 16,
      409,
      "SERVICE_CYCLE",
      "A cyclic or excessively deep service call was rejected.",
    );
    const server = await stagedModuleServer(tx, module, servers);
    requireCondition(
      server,
      409,
      "BACKEND_UNAVAILABLE",
      `Stage the reviewed backend for ${module.id}@${module.version} before activation.`,
    );
    requireCondition(
      canonical(server.module) === canonical(module),
      409,
      "BACKEND_CONTRACT_MISMATCH",
      "The staged backend contract does not match the signed release.",
    );
    assertSchema(operation.input, value);
    {
      if (server.kind === "trusted")
        return await server.execute(name, value, { tx, ctx });
      const activation = found(
        await tx
          .selectFrom("suite.module_activations")
          .select("config")
          .where("workspace_id", "=", ctx.workspaceId)
          .where("module_id", "=", module.id)
          .executeTakeFirst(),
      );
      let failure: unknown;
      let failed = false;
      let closed = false;
      // A handler cannot accidentally commit detached or caught failed capability writes.
      const pending = new Set<Promise<unknown>>();
      const guarded = <T>(fn: () => Promise<T>): Promise<T> => {
        const task = Promise.resolve().then(() => {
          requireCondition(
            !closed,
            409,
            "OPERATION_CLOSED",
            "This operation has already finished.",
          );
          return fn();
        });
        pending.add(task);
        void task.then(
          () => pending.delete(task),
          (error) => {
            failed = true;
            failure ??= error;
            pending.delete(task);
          },
        );
        return task;
      };
      let result: unknown;
      try {
        result = await server.execute(name, value, {
          actor: { id: ctx.actor.id, membershipId: ctx.membershipId },
          workspaceId: ctx.workspaceId,
          requestId: ctx.requestId,
          permissions: ctx.permissions,
          configuration: activation.config,
          resource: (call) =>
            guarded(async () => {
              requireCondition(
                call.moduleId === module.id &&
                  call.resource &&
                  call.action !== "operation",
                403,
                "CAPABILITY_DENIED",
                "Use declared services for cross-module access.",
              );
              return executeResource(
                tx,
                ctx,
                module.id,
                {
                  action: call.action,
                  resource: call.resource,
                  input: call.input,
                } as ResourceCommand,
                module,
              );
            }),
          emit: (event, payload) =>
            guarded(async () => {
              const schema = found(module.events?.[event]);
              assertSchema(schema, payload);
              await publish(tx, ctx, `module.${module.id}.event.${event}`, {
                data: payload,
                moduleVersion: module.version,
              });
            }),
          service: (alias, serviceInput) =>
            guarded(async () => {
              const reference = found(module.services?.[alias]);
              const range = module.dependencies[reference.moduleId];
              requireCondition(
                range,
                403,
                "UNDECLARED_DEPENDENCY",
                "Declare the service provider as a dependency.",
              );
              const target = await workspaceModule(
                tx,
                ctx.workspaceId,
                reference.moduleId,
              );
              const contract = found(target.operations[reference.operation]);
              requireCondition(
                contract.public && satisfies(target.version, range),
                409,
                "SERVICE_INCOMPATIBLE",
                "The installed module does not expose a compatible public service.",
              );
              // Matching schemas are required even for semver-compatible releases.
              requireCondition(
                canonical(contract) === canonical(reference.contract),
                409,
                "SERVICE_CONTRACT_MISMATCH",
                "Rebuild the consumer against the installed public service contract.",
              );
              const grant = await tx
                .selectFrom("suite.platform_settings")
                .select("value")
                .where("workspace_id", "=", ctx.workspaceId)
                .where("key", "=", `grant:${module.id}:${target.id}`)
                .executeTakeFirst();
              requireCondition(
                Array.isArray(grant?.value.services) &&
                  grant.value.services.includes(reference.operation),
                403,
                "GRANT_REQUIRED",
                `An administrator must grant ${module.name} access to ${target.id}.${reference.operation}.`,
              );
              return invoke(target, reference.operation, serviceInput, [
                ...active,
                identity,
              ]);
            }),
        });
      } catch (error) {
        failed = true;
        failure ??= error;
      }
      // Drain child calls before the outer transaction is allowed to close.
      while (pending.size) await Promise.allSettled([...pending]);
      closed = true;
      if (failed) throw failure;
      assertSchema(operation.output, result);
      await audit(tx, ctx, `${module.id}.operation.${name}`, module.id);
      return result;
    }
  };
  try {
    return await invoke(definition, operationName, input);
  } catch (error) {
    // Undeclared provider errors must not masquerade as a caller's typed business errors.
    if (
      error instanceof ModuleBusinessError &&
      (error.moduleId !== definition.id || error.operation !== operationName)
    )
      throw new Error("A dependent service rejected the operation.", {
        cause: error,
      });
    throw error;
  }
}
