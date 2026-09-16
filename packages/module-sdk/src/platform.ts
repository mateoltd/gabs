import { Type, type Static } from "@sinclair/typebox";
import type { ModuleDefinition } from "./index";
import type { OrganizationPolicy } from "./governance";
export interface PlatformState {
  modules: ModuleDefinition[];
  storage?: {
    module_id: string;
    schema_version: number;
    release_version: string;
  }[];
  installations: {
    module_id: string;
    device_id: string;
    version: string;
    state: string;
    updated_at: string;
  }[];
  releases: {
    module_id: string;
    version: string;
    manifest: Record<string, unknown>;
    digest: string;
    signature: string;
    key_id: string;
  }[];
  organization: (OrganizationPolicy & { version: number }) | null;
  roles: {
    id: string;
    name: string;
    permissions: string[];
    protected: boolean;
  }[];
  settings: { key: string; value: Record<string, unknown>; version: number }[];
  config: { moduleId: string; config: Record<string, unknown> }[];
  permissionSources: Record<string, { grants: string[]; denies: string[] }>;
}
export interface SignedArtifact {
  module_id: string;
  version: string;
  manifest: Record<string, unknown>;
  digest: string;
  signature: string;
  key_id: string;
  artifact: Record<string, unknown>;
}

/** Exact immutable bytes selected for a device installation. */
export interface InstallationSelection {
  moduleId: string;
  version: string;
  digest: string;
}
export interface InstallationReceipt {
  id: string;
  action: "install" | "uninstall";
  moduleId: string;
  deviceId: string;
  releases: InstallationSelection[];
}

export const ModuleRolloutSchema = Type.Object(
  {
    moduleId: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }),
    version: Type.String({ maxLength: 40 }),
    mandatory: Type.Boolean(),
    acceptedVersions: Type.Array(Type.String({ minLength: 1, maxLength: 40 }), {
      maxItems: 10,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export type ModuleRollout = Static<typeof ModuleRolloutSchema>;

const RecoveryId = Type.String({ minLength: 1, maxLength: 128 });
const RecoveryName = Type.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" });
const RecoveryVersion = Type.String({ minLength: 1, maxLength: 40 });
const RecoveryData = Type.Record(Type.String(), Type.Unknown());
const RecoveryInput = Type.Object(
  {
    data: RecoveryData,
    id: Type.Optional(RecoveryId),
    baseVersion: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);
const recoveryRequestProperties = {
  moduleId: RecoveryName,
  moduleVersion: RecoveryVersion,
  resource: RecoveryName,
  key: RecoveryId,
};
const RecoveryRequest = Type.Union([
  Type.Object(
    {
      ...recoveryRequestProperties,
      action: Type.Literal("create"),
      input: Type.Object(
        { id: RecoveryId, data: RecoveryData },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...recoveryRequestProperties,
      action: Type.Literal("update"),
      input: Type.Object(
        {
          id: RecoveryId,
          data: RecoveryData,
          baseVersion: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);
const recoveryProperties = {
  kind: Type.Literal("module-input-recovery"),
  userId: RecoveryId,
  workspaceId: RecoveryId,
  moduleId: RecoveryName,
  moduleVersion: RecoveryVersion,
  resource: RecoveryName,
  input: RecoveryInput,
};
/** User-exported input, never proof of server acceptance or authorization. */
export const ModuleInputRecoverySchema = Type.Union([
  Type.Object(
    { ...recoveryProperties, status: Type.Literal("unsaved") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...recoveryProperties,
      status: Type.Literal("unconfirmed"),
      pendingRequest: RecoveryRequest,
    },
    { additionalProperties: false },
  ),
]);
export type ModuleInputRecovery = Static<typeof ModuleInputRecoverySchema>;
