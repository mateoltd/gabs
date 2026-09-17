import { Type, type Static } from "@sinclair/typebox";
import { assertSchema, type ModuleDefinition } from "../index";
import { canonical } from "./registry";
const object = <P extends Parameters<typeof Type.Object>[0]>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });
export const hostCapabilitySchemas = {
  "files.export": {
    input: object({
      filename: Type.String({
        pattern: "^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}\\.(csv|json|txt)$",
      }),
      content: Type.String({ maxLength: 20 * 1024 * 1024 }),
    }),
    output: object({
      status: Type.Union([
        Type.Literal("saved"),
        Type.Literal("offered"),
        Type.Literal("cancelled"),
      ]),
    }),
  },
  "notifications.show": {
    input: object({
      title: Type.String({ minLength: 1, maxLength: 200 }),
      message: Type.String({ minLength: 1, maxLength: 500 }),
    }),
    output: object({ requested: Type.Boolean() }),
  },
  "lan.status": {
    input: object({}),
    output: object({
      enabled: Type.Boolean(),
      configured: Type.Boolean(),
      peers: Type.Array(
        object({
          id: Type.String(),
          address: Type.String(),
          port: Type.Integer(),
          seen: Type.Number(),
        }),
      ),
    }),
  },
  "lan.relay": {
    input: object({
      peerId: Type.String({ minLength: 1, maxLength: 150 }),
      kind: Type.Union([Type.Literal("artifact"), Type.Literal("pending")]),
      id: Type.String({ minLength: 1, maxLength: 128 }),
      payload: Type.String({ maxLength: 200000 }),
    }),
    output: object({
      relayed: Type.Literal(true),
      authoritative: Type.Literal(false),
    }),
  },
} as const;
export type HostCapabilityKind = keyof typeof hostCapabilitySchemas;
export interface HostCapability {
  kind: HostCapabilityKind;
  permission: string;
  /** Requires a server-issued, expiring lease. Omitted declarations remain online-only. */
  offline?: "lease";
}
type CapabilityDeclaration = HostCapability &
  (
    | { kind: "files.export" | "notifications.show" }
    | { kind: "lan.status" | "lan.relay"; offline?: never }
  );
export function capability<const C extends CapabilityDeclaration>(
  definition: C,
): C {
  return definition;
}
export interface HostCapabilityCall {
  moduleId: string;
  moduleVersion: string;
  capability: string;
  input: unknown;
}
export class HostCapabilityError extends Error {
  constructor(
    public readonly code:
      | "CAPABILITY_UNDECLARED"
      | "CAPABILITY_UNAVAILABLE"
      | "CAPABILITY_RESPONSE_INVALID",
    message: string,
  ) {
    super(message);
  }
}
export function validateHostCapabilities(
  module: Pick<ModuleDefinition, "id" | "permissions" | "capabilities">,
) {
  for (const [name, declaration] of Object.entries(module.capabilities ?? {})) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
      !declaration ||
      !Object.hasOwn(hostCapabilitySchemas, declaration.kind) ||
      (declaration.offline !== undefined &&
        (declaration.offline !== "lease" ||
          !["files.export", "notifications.show"].includes(
            declaration.kind,
          ))) ||
      !module.permissions.includes(declaration.permission) ||
      !declaration.permission.startsWith(module.id + ".")
    )
      throw Error(`Invalid or undeclared host capability: ${name}`);
  }
}
export function verifyCapabilityManifest(
  artifact: Record<string, unknown>,
  manifest: Record<string, unknown>,
) {
  if (
    canonical(artifact.capabilities ?? {}) !==
    canonical(manifest.capabilities ?? {})
  )
    throw Error("Host capabilities do not match the signed manifest.");
}
export function resolveHostCapability(
  module: ModuleDefinition,
  name: string,
  input: unknown,
) {
  if (!module.capabilities || !Object.hasOwn(module.capabilities, name))
    throw new HostCapabilityError(
      "CAPABILITY_UNDECLARED",
      "This module did not declare the requested host capability.",
    );
  const declared = module.capabilities[name];
  const schema = hostCapabilitySchemas[declared.kind];
  if (!schema)
    throw new HostCapabilityError(
      "CAPABILITY_UNAVAILABLE",
      "This host does not support the requested capability.",
    );
  assertSchema(schema.input, input);
  return declared;
}
export type HostCapabilityName<M extends ModuleDefinition> = keyof NonNullable<
  M["capabilities"]
> &
  string;
type Names<M extends ModuleDefinition> = HostCapabilityName<M>;
type Kind<M extends ModuleDefinition, N extends Names<M>> = NonNullable<
  M["capabilities"]
>[N]["kind"];
export type HostCapabilityResult<
  M extends ModuleDefinition,
  N extends Names<M>,
> = Static<(typeof hostCapabilitySchemas)[Kind<M, N>]["output"]>;
export type HostCapabilityResults<M extends ModuleDefinition> = {
  [N in Names<M>]?: HostCapabilityResult<M, N>;
};
export interface ModuleHost<M extends ModuleDefinition> {
  call<N extends Names<M>>(
    name: N,
    input: Static<(typeof hostCapabilitySchemas)[Kind<M, N>]["input"]>,
  ): Promise<Static<(typeof hostCapabilitySchemas)[Kind<M, N>]["output"]>>;
}
export function createModuleHost<M extends ModuleDefinition>(
  module: M,
  send: (call: HostCapabilityCall) => Promise<unknown>,
): ModuleHost<M> {
  return {
    async call(name, input) {
      const declaration = resolveHostCapability(module, name, input);
      const result = await send({
        moduleId: module.id,
        moduleVersion: module.version,
        capability: name,
        input,
      });
      try {
        assertSchema(hostCapabilitySchemas[declaration.kind].output, result);
      } catch {
        throw new HostCapabilityError(
          "CAPABILITY_RESPONSE_INVALID",
          "The host action returned an unverified result. Check its outcome before retrying.",
        );
      }
      return result as never;
    },
  };
}
export const HostAuthorizationSchema = object({
  moduleId: Type.String(),
  moduleVersion: Type.String(),
  capability: Type.String(),
  kind: Type.Union([
    Type.Literal("files.export"),
    Type.Literal("notifications.show"),
    Type.Literal("lan.status"),
    Type.Literal("lan.relay"),
  ]),
  userId: Type.String(),
  workspaceId: Type.String(),
});
export type HostAuthorization = Static<typeof HostAuthorizationSchema>;
