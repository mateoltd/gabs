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
