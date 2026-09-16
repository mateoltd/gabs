import { assertSchema, type ModuleDefinition, type Static } from "./index";
import {
  createModuleContext,
  ModuleBusinessError,
  type ModuleCapabilities,
  type OperationContext,
} from "./context";
export {
  type ModuleContext,
  type OperationContext,
  type ModuleCapabilities,
  ModuleBusinessError,
} from "./context";
export interface ScopedModuleServer {
  readonly kind: "scoped";
  module: ModuleDefinition;
  execute(
    name: string,
    input: unknown,
    capabilities: ModuleCapabilities,
  ): Promise<unknown>;
}
/** Reviewed module handlers receive only typed, scoped host capabilities. */
export function defineModuleServer<const M extends ModuleDefinition>(
  module: M,
) {
  return (handlers: {
    [K in keyof M["operations"]]: (
      context: OperationContext<M, K>,
      input: Static<M["operations"][K]["input"]>,
    ) => Promise<Static<M["operations"][K]["output"]>>;
  }): ScopedModuleServer => ({
    kind: "scoped",
    module,
    async execute(name, input, capabilities) {
      const definition = module.operations[name];
      if (!definition || !Object.hasOwn(handlers, name))
        throw Error(`Unregistered module operation: ${module.id}.${name}`);
      assertSchema(definition.input, input);
      const context = createModuleContext(module, capabilities);
      const operationContext = Object.freeze({
        ...context,
        reject(error: unknown): never {
          if (!definition.errors)
            throw Error(`No business errors declared for ${module.id}.${name}`);
          assertSchema(definition.errors, error);
          throw new ModuleBusinessError(module.id, name, error);
        },
      });
      const result = await handlers[name as keyof typeof handlers](
        operationContext,
        input,
      );
      assertSchema(definition.output, result);
      return result;
    },
  });
}
export interface TrustedModuleServer<Context> {
  readonly kind: "trusted";
  module: ModuleDefinition;
  execute(name: string, input: unknown, context: Context): Promise<unknown>;
}
/** Host-owned migration bridge for existing business services. Not the module authoring API. */
export function defineTrustedModuleServer<const M extends ModuleDefinition>(
  module: M,
) {
  return <Context>(handlers: {
    [K in keyof M["operations"]]: (
      context: Context,
      input: Static<M["operations"][K]["input"]>,
    ) => Promise<Static<M["operations"][K]["output"]>>;
  }): TrustedModuleServer<Context> => ({
    kind: "trusted",
    module,
    async execute(name, input, context) {
      const definition = module.operations[name];
      if (!definition || !Object.hasOwn(handlers, name))
        throw Error(`Unregistered module operation: ${module.id}.${name}`);
      assertSchema(definition.input, input);
      const result = await handlers[name as keyof typeof handlers](
        context,
        input,
      );
      assertSchema(definition.output, result);
      return result;
    },
  });
}
