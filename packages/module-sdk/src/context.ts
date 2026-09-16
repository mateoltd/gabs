import { createStores, type ModuleStores, type StoreTransport } from "./store";
import {
  assertSchema,
  createModuleClient,
  type ModuleDefinition,
  type ModuleTransport,
  type Operation,
  type Static,
  type TSchema,
} from "./index";

/** A public operation contract, copied into the consuming signed manifest. */
export interface ServiceReference<O extends Operation = Operation> {
  moduleId: string;
  operation: string;
  version: string;
  contract: O;
}
export function serviceReference<
  M extends ModuleDefinition,
  K extends keyof M["operations"] & string,
>(module: M, name: K): ServiceReference<M["operations"][K]> {
  const contract = module.operations[name] as M["operations"][K];
  if (!contract.public)
    throw Error(`${module.id}.${name} is not a public service.`);
  return {
    moduleId: module.id,
    operation: name,
    version: module.version,
    contract,
  };
}
export type Configuration<M extends ModuleDefinition> = Static<
  M["configuration"]
>;
export type OperationInput<
  M extends ModuleDefinition,
  K extends keyof M["operations"],
> = Static<M["operations"][K]["input"]>;
export type OperationOutput<
  M extends ModuleDefinition,
  K extends keyof M["operations"],
> = Static<M["operations"][K]["output"]>;
export type OperationError<
  M extends ModuleDefinition,
  K extends keyof M["operations"],
> = M["operations"][K] extends { errors: infer E extends TSchema }
  ? Static<E>
  : never;
export type ModuleEvents<M extends ModuleDefinition> = M extends {
  events: infer E extends Record<string, TSchema>;
}
  ? E
  : Record<string, never>;
export type ModuleServices<M extends ModuleDefinition> = M extends {
  services: infer S extends Record<string, ServiceReference>;
}
  ? S
  : Record<string, never>;
export type ServiceResult<
  M extends ModuleDefinition,
  K extends keyof ModuleServices<M>,
> =
  | { ok: true; value: Static<ModuleServices<M>[K]["contract"]["output"]> }
  | {
      ok: false;
      error: ModuleServices<M>[K]["contract"] extends {
        errors: infer E extends TSchema;
      }
        ? Static<E>
        : never;
    };
export type ModuleResources<M extends ModuleDefinition> = ReturnType<
  typeof createModuleClient<M>
>["resource"];
export class ModuleBusinessError extends Error {
  readonly code = "MODULE_BUSINESS_ERROR";
  constructor(
    public readonly moduleId: string,
    public readonly operation: string,
    public readonly detail: unknown,
  ) {
    super("The module rejected this operation.");
  }
}
export interface ModuleContext<M extends ModuleDefinition> {
  readonly actor: Readonly<{ id: string; membershipId: string }>;
  readonly workspaceId: string;
  readonly requestId: string;
  readonly caller?: Readonly<{ moduleId: string; operation: string }>;
  readonly configuration: Readonly<Configuration<M>>;
  hasPermission(permission: M["permissions"][number]): boolean;
  resource: ModuleResources<M>;
  store: ModuleStores<M>;
  audit(
    action: M extends { audit: readonly (infer K extends string)[] }
      ? K
      : never,
    targetId: string,
  ): Promise<void>;
  emit<K extends keyof ModuleEvents<M> & string>(
    event: K,
    payload: Static<ModuleEvents<M>[K]>,
  ): Promise<void>;
  service<K extends keyof ModuleServices<M> & string>(
    name: K,
    input: Static<ModuleServices<M>[K]["contract"]["input"]>,
  ): Promise<Static<ModuleServices<M>[K]["contract"]["output"]>>;
  /** A rejected child still aborts the transaction. Translate it with ctx.reject. */
  serviceAttempt<K extends keyof ModuleServices<M> & string>(
    name: K,
    input: Static<ModuleServices<M>[K]["contract"]["input"]>,
  ): Promise<ServiceResult<M, K>>;
}
export type OperationContext<
  M extends ModuleDefinition,
  K extends keyof M["operations"],
> = ModuleContext<M> & {
  reject(error: OperationError<M, K>): never;
};
/** Narrow, host-implemented capabilities. No database handle or privileged process object. */
export interface ModuleCapabilities {
  actor: { id: string; membershipId: string };
  workspaceId: string;
  requestId: string;
  caller?: { moduleId: string; operation: string };
  permissions: readonly string[];
  configuration: unknown;
  resource: ModuleTransport;
  store?: StoreTransport;
  audit?(action: string, targetId: string): Promise<void>;
  emit(event: string, payload: unknown): Promise<void>;
  service(name: string, input: unknown): Promise<unknown>;
}
export function createModuleContext<M extends ModuleDefinition>(
  module: M,
  capabilities: ModuleCapabilities,
): ModuleContext<M> {
  assertSchema(module.configuration, capabilities.configuration);
  const service = (name: string, input: unknown) => {
    const reference = module.services?.[name];
    if (!reference) throw Error(`Undeclared service: ${module.id}.${name}`);
    assertSchema(reference.contract.input, input);
    const pending = capabilities.service(name, input).then((output) => {
      assertSchema(reference.contract.output, output);
      return output;
    });
    void pending.catch(() => undefined);
    return pending;
  };
  return Object.freeze({
    actor: Object.freeze({ ...capabilities.actor }),
    workspaceId: capabilities.workspaceId,
    requestId: capabilities.requestId,
    ...(capabilities.caller
      ? { caller: Object.freeze({ ...capabilities.caller }) }
      : {}),
    configuration: structuredClone(capabilities.configuration),
    hasPermission: (permission: string) =>
      module.permissions.includes(permission) &&
      capabilities.permissions.includes(permission),
    resource: createModuleClient(module, capabilities.resource).resource,
    store: createStores(module, capabilities.store),
    audit(action: string, targetId: string) {
      if (!capabilities.audit)
        throw Error(
          "Audit recording requires an authoritative host capability.",
        );
      // The host validates declarations inside its tracked transaction. A caught
      // invalid audit must roll back earlier writes just like a failed store call.
      const task = capabilities.audit(action, targetId);
      void task.catch(() => undefined);
      return task;
    },
    emit(name: string, payload: unknown) {
      const schema = module.events?.[name];
      if (!schema) throw Error(`Undeclared event: ${module.id}.${name}`);
      assertSchema(schema, payload);
      const pending = capabilities.emit(name, payload);
      void pending.catch(() => undefined);
      return pending;
    },
    service,
    serviceAttempt(name: string, input: unknown) {
      const pending = service(name, input).then(
        (value) => ({ ok: true, value }),
        (error: unknown) => {
          const reference = module.services![name];
          const schema = reference.contract.errors;
          if (
            !(error instanceof ModuleBusinessError) ||
            !schema ||
            error.moduleId !== reference.moduleId ||
            error.operation !== reference.operation
          )
            throw error;
          assertSchema(schema, error.detail);
          return { ok: false, error: error.detail };
        },
      );
      void pending.catch(() => undefined);
      return pending;
    },
  }) as ModuleContext<M>;
}
