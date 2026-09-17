import {
  assertSchema,
  Type,
  type ModuleDefinition,
  type Static,
  type JsonRecord,
  type ResourceRecord,
  type Store,
} from "./index";
import type { ScopedModuleServer } from "./server";
import { canonical } from "./registry";
import {
  hostCapabilitySchemas,
  type HostCapabilityResults,
} from "./host-capabilities";

export type ModuleFixtures<M extends ModuleDefinition> = {
  [K in keyof M["resources"]]?: Array<Static<M["resources"][K]["schema"]>>;
};
export interface SimulationRecord<T = JsonRecord> {
  id: string;
  data: T;
  version?: number;
  archived?: boolean;
}
export type ResourceFixtures<M extends ModuleDefinition> = {
  [K in keyof M["resources"]]?: SimulationRecord<
    Static<M["resources"][K]["schema"]>
  >[];
};
type Stores<M extends ModuleDefinition> = M extends {
  stores: infer S extends Record<string, Store>;
}
  ? S
  : Record<string, never>;
export type StoreFixtures<M extends ModuleDefinition> = {
  [K in keyof Stores<M>]?: SimulationRecord<Static<Stores<M>[K]["schema"]>>[];
};
export interface SimulationModule<
  M extends ModuleDefinition = ModuleDefinition,
> {
  module: M;
  fixtures?: ModuleFixtures<M>;
  records?: ResourceFixtures<M>;
  stores?: StoreFixtures<M>;
  configuration?: Static<M["configuration"]>;
  server?: ScopedModuleServer;
  grants?: readonly SimulationGrant[];
  readGrants?: readonly import("./simulator").SimulationReadGrant[];
  members?: readonly import("./simulator").SimulationMember[];
  /** Simulated adapter replies; no device effect is performed. */
  hostResults?: HostCapabilityResults<M>;
}
export interface SimulationGrant {
  consumerId: string;
  providerId: string;
  operation: string;
}
export interface SimulationStoreRecord<T = JsonRecord> {
  id: string;
  data: T;
  version: number;
  archived: boolean;
}
export type SimulationNamespace<M extends ModuleDefinition> = {
  records: {
    [K in keyof M["resources"]]: ResourceRecord<
      Static<M["resources"][K]["schema"]>
    >[];
  };
  stores: {
    [K in keyof Stores<M>]: SimulationStoreRecord<
      Static<Stores<M>[K]["schema"]>
    >[];
  };
  permissions: string[];
};
export const simulationError = (
  status: number,
  code: string,
  message: string,
) => Object.assign(Error(message), { status, code });

export function validateFixtures(
  module: ModuleDefinition,
  fixtures: unknown,
): asserts fixtures is Record<string, JsonRecord[]> {
  if (!fixtures || typeof fixtures !== "object" || Array.isArray(fixtures))
    throw Error("Fixtures must map resource names to arrays of records.");
  for (const [name, rows] of Object.entries(fixtures)) {
    const resource =
      Object.hasOwn(module.resources, name) && module.resources[name];
    if (!resource || !Array.isArray(rows))
      throw Error(`Invalid fixture resource: ${name}`);
    rows.forEach((data, index) => {
      try {
        assertSchema(resource.schema, data);
      } catch (error) {
        throw Error(`Fixture ${name}[${index}]: ${(error as Error).message}`);
      }
    });
  }
}
export function defineFixtures<M extends ModuleDefinition>(
  module: M,
  fixtures: ModuleFixtures<M>,
): ModuleFixtures<M> {
  validateFixtures(module, fixtures);
  return fixtures;
}
const recordSchema = Type.Object(
  {
    id: Type.String({
      pattern:
        "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
    }),
    data: Type.Unknown(),
    version: Type.Optional(Type.Integer({ minimum: 1, maximum: 2147483646 })),
    archived: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export function defineSimulationModule<const M extends ModuleDefinition>(
  module: M,
  options: Omit<SimulationModule<M>, "module"> = {},
): SimulationModule<M> {
  assertSchema(module.configuration, options.configuration ?? {});
  validateFixtures(module, options.fixtures ?? {});
  for (const [name, result] of Object.entries(options.hostResults ?? {})) {
    if (!module.capabilities || !Object.hasOwn(module.capabilities, name))
      throw Error(`Undeclared host capability fixture: ${name}`);
    if (result === undefined) continue;
    assertSchema(
      hostCapabilitySchemas[module.capabilities[name].kind].output,
      result,
    );
  }
  if (
    options.server &&
    (options.server.kind !== "scoped" ||
      canonical(options.server.module) !== canonical(module))
  )
    throw Error(
      `The simulation backend must match ${module.id}@${module.version} exactly.`,
    );
  for (const [group, definitions, collections] of [
    ["resource", module.resources, options.records ?? {}],
    ["store", module.stores ?? {}, options.stores ?? {}],
  ] as const) {
    for (const [name, rows] of Object.entries(collections)) {
      if (!Object.hasOwn(definitions, name) || !Array.isArray(rows))
        throw Error(`Invalid ${module.id} ${group} fixture: ${name}`);
      const seen = new Set<string>();
      for (const [index, record] of rows.entries()) {
        try {
          assertSchema(recordSchema, record);
          assertSchema(definitions[name].schema, record.data);
          const id = record.id.toLowerCase();
          if (seen.has(id)) throw Error("Duplicate fixture record ID.");
          seen.add(id);
        } catch (error) {
          throw Error(
            `Fixture ${module.id}.${name}[${index}]: ${(error as Error).message}`,
          );
        }
      }
    }
  }
  return { ...options, module };
}

/** Explicit development grants use the consumer's inferred service aliases. */
export function grantSimulationServices<const M extends ModuleDefinition>(
  module: M,
  ...aliases: (M extends { services: infer S } ? keyof S & string : never)[]
): SimulationGrant[] {
  return aliases.map((alias) => {
    const reference = module.services?.[alias];
    if (!reference) throw Error(`Undeclared service: ${module.id}.${alias}`);
    return {
      consumerId: module.id,
      providerId: reference.moduleId,
      operation: reference.operation,
    };
  });
}
