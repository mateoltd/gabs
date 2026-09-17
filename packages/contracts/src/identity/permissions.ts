import { Type } from "@sinclair/typebox";

export const PLATFORM_PERMISSIONS = [
  "workspace.manage",
  "members.manage",
  "roles.manage",
  "modules.manage",
  "audit.read",
  "billing.manage",
] as const;

export type Permission = string;
export const PermissionSchema = Type.String({ maxLength: 200 });
