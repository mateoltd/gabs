import {
  authentication as createAuthentication,
  assignModules as assignProductModules,
  authorize as authorizeRequest,
  checkModule as checkProductModule,
  identify as identifyProductUser,
  provisionWorkspace as provisionProductWorkspace,
  registeredModuleIds as productModuleIds,
  workspaceBusinessPermissions as productBusinessPermissions,
  workspaceDependencies as productDependencies,
  workspaceDependencyIds as productDependencyIds,
  workspaceModule as productModule,
} from "@suite/server-core";
import type { Actor, AuthConfig, DB, Tx } from "@suite/server-core";
import type { ModuleId, Permission } from "@suite/contracts";
import { productServerRuntime } from "../presets/index";

export * from "@suite/server-core";

export const authentication = (db: DB, config: AuthConfig) =>
  createAuthentication(db, config, productServerRuntime);
export const identify = (
  db: DB,
  input: Parameters<typeof identifyProductUser>[1],
) => identifyProductUser(db, input, productServerRuntime);
export const provisionWorkspace = (
  tx: Tx,
  input: Parameters<typeof provisionProductWorkspace>[1],
) => provisionProductWorkspace(tx, input, productServerRuntime);
export const authorize = (
  tx: Tx,
  actor: Actor,
  workspaceId: string,
  requestId: string,
  permission?: Permission,
  moduleId?: ModuleId,
) =>
  authorizeRequest(
    tx,
    actor,
    workspaceId,
    requestId,
    productServerRuntime,
    permission,
    moduleId,
  );
export const checkModule = (
  tx: Tx,
  workspaceId: string,
  membershipId: string,
  moduleId: ModuleId,
) =>
  checkProductModule(
    tx,
    workspaceId,
    membershipId,
    moduleId,
    productServerRuntime,
  );
export const workspaceModule = (
  tx: Tx,
  workspaceId: string,
  id: string,
  version?: string,
) => productModule(tx, workspaceId, id, productServerRuntime.catalog, version);
export const workspaceDependencies = (
  tx: Tx,
  workspaceId: string,
  id: string,
) => productDependencies(tx, workspaceId, id, productServerRuntime.catalog);
export const workspaceDependencyIds = (
  tx: Tx,
  workspaceId: string,
  id: string,
) => productDependencyIds(tx, workspaceId, id, productServerRuntime.catalog);
export const registeredModuleIds = (tx: Tx) =>
  productModuleIds(tx, productServerRuntime.catalog);
export const workspaceBusinessPermissions = (tx: Tx, workspaceId: string) =>
  productBusinessPermissions(tx, workspaceId, productServerRuntime.catalog);
export const assignModules = (
  tx: Tx,
  workspaceId: string,
  membershipId: string,
  moduleIds: string[],
) =>
  assignProductModules(
    tx,
    workspaceId,
    membershipId,
    moduleIds,
    productServerRuntime.catalog,
  );
