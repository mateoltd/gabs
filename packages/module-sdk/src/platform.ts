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
