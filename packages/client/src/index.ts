import type {
  Bootstrap,
  DraftInput,
  Order,
  Product,
  OperationRequest,
  LoginOptions,
} from "@suite/contracts";
export interface Scope {
  userId: string;
  workspaceId: string;
}
export type CacheKey =
  "snapshot" | "drafts" | "pending" | "module-state" | ModuleArtifactKey;
export type ModuleArtifactKey = `module-artifact/${string}/${number}`;
export const isModuleArtifactKey = (key: unknown): key is ModuleArtifactKey =>
  typeof key === "string" &&
  /^module-artifact\/[a-f0-9]{64}\/(0|[1-9][0-9]{0,3})$/.test(key);
export interface Snapshot {
  bootstrap: Bootstrap;
  products: Product[];
  orders: Order[];
  expiresAt: number;
  cachedAt: number;
}
export interface LocalDraft {
  /** Exact release used by a submitted attempt; absent for a new, unsubmitted draft. */
  moduleVersion?: string;
  id: string;
  input: DraftInput;
  remoteId?: string;
  baseVersion?: number;
  uploadKey: string;
  updatedAt: number;
  state: "local" | "conflict" | "uploading";
}
export interface PendingCommand {
  /** Older saved commands used the bundled Orders 1.1 contract. */
  moduleVersion?: string;
  operation: "orderConfirm" | "orderFulfill" | "orderCancel";
  orderId: string;
  version: number;
  key: string;
}
export interface RememberedIdentity {
  userId: string;
  name: string;
  workspaceId: string;
}
export interface Platform {
  kind: "web" | "desktop";
  load<T>(scope: Scope, key: CacheKey): Promise<T | undefined>;
  save<T>(scope: Scope, key: CacheKey, value: T): Promise<void>;
  pruneModuleArtifacts(scope: Scope, keep: ModuleArtifactKey[]): Promise<void>;
  purgeWorkspace(scope: Scope): Promise<void>;
  purgeUser(userId: string): Promise<void>;
  identity(): Promise<RememberedIdentity | undefined>;
  rememberIdentity(identity: RememberedIdentity | undefined): Promise<void>;
  saveFile(filename: string, content: string): Promise<void>;
  notify(title: string, message: string): Promise<void>;
}
export interface LanStatus {
  enabled: boolean;
  configured: boolean;
  workspaceId?: string;
  peers: { id: string; address: string; port: number; seen: number }[];
  port?: number;
}
export interface LanReceiptSelection {
  id: string;
  digest: string;
  location: "inbox" | "archive";
}
export interface LanArchiveState {
  receipts: LanReceipt[];
  countLimit: number;
  byteLimit: number;
  usedBytes: number;
  inboxCount: number;
  inboxLimit: number;
}
export interface LanReceipt {
  canExport: boolean;
  id: string;
  digest: string;
  kind: "artifact" | "pending";
  state:
    "received" | "pending" | "accepted" | "rejected" | "conflict" | "invalid";
  moduleId?: string;
  action?: string;
  target?: string;
  input?: unknown;
  dependencies?: number;
  message: string;
}
export interface DesktopBridge {
  lanArchive(scope: Scope): Promise<LanArchiveState>;
  archiveLanReceipt(
    scope: Scope,
    selection: LanReceiptSelection,
  ): Promise<void>;
  restoreLanReceipt(
    scope: Scope,
    selection: LanReceiptSelection,
  ): Promise<void>;
  deleteLanReceipt(
    scope: Scope,
    selection: LanReceiptSelection,
    confirmation: boolean,
  ): Promise<void>;
  exportLanReceipt(
    scope: Scope,
    selection: LanReceiptSelection,
  ): Promise<{ status: "saved" | "cancelled" }>;
  importLanReceipt(scope: Scope): Promise<{ status: "restored" | "cancelled" }>;
  receivedPackage(
    scope: Scope,
    selection: import("@suite/module-sdk/platform").InstallationSelection,
  ): Promise<
    | {
        pkg: import("@suite/module-sdk/platform").SignedArtifact;
        transferId: string;
      }
    | undefined
  >;
  acknowledgePackage(scope: Scope, transferId: string): Promise<void>;
  lanReceipts(scope: Scope): Promise<LanReceipt[]>;
  submitLanReceipt(scope: Scope, id: string, digest: string): Promise<void>;
  dismissLanReceipt(scope: Scope, id: string, digest: string): Promise<void>;
  downloadExport(
    handle: string,
    id: string,
  ): Promise<{ status: "saved" | "cancelled" }>;
  prepareModuleOffline(
    scope: Scope,
    moduleId: string,
    moduleVersion: string,
    enabled: boolean,
  ): Promise<{ expiresAt?: number; capabilities?: string[] }>;
  openLocalDevice(
    request: LocalDesktopDeviceRequest,
    recheck: () => Promise<void>,
  ): Promise<string>;
  executeLocalDevice(handle: string): Promise<unknown>;
  closeLocalDevice(handle: string): Promise<void>;
  openModuleHost(
    scope: Scope,
    moduleId: string,
    moduleVersion: string,
  ): Promise<string>;
  closeModuleHost(handle: string): Promise<void>;
  moduleCapability(
    handle: string,
    capability: string,
    input: unknown,
  ): Promise<unknown>;
  openBilling(url: string): Promise<void>;
  lanStatus(scope: Scope): Promise<LanStatus>;
  onLanChanged(callback: () => void): () => void;
  setLan(scope: Scope, enabled: boolean): Promise<LanStatus>;
  authStatus(): Promise<{
    mode: "development" | "oidc" | "unconfigured";
  }>;
  execute(
    request: OperationRequest,
  ): Promise<{ status: number; body: unknown }>;
  login(options?: LoginOptions): Promise<void>;
  logout(): Promise<void>;
  cacheRead(scope: Scope, key: CacheKey): Promise<unknown>;
  cacheWrite(scope: Scope, key: CacheKey, value: unknown): Promise<void>;
  cachePruneArtifacts(scope: Scope, keep: ModuleArtifactKey[]): Promise<void>;
  cachePurge(scope: { userId: string; workspaceId?: string }): Promise<void>;
  identity(): Promise<RememberedIdentity | undefined>;
  rememberIdentity(value: RememberedIdentity | undefined): Promise<void>;
  saveFile(filename: string, content: string): Promise<void>;
  notify(title: string, message: string): Promise<void>;
  securityStatus(): Promise<{
    persistentStorage: boolean;
    updateRequired: boolean;
  }>;
}
/** Local host consent context only; never a corporate or IPC bearer authorization. */
export interface LocalDesktopDeviceRequest {
  profileId: string;
  grantId: string;
  releaseDigest: string;
  kind: import("@suite/module-sdk/host-capabilities").HostCapabilityKind;
  call: import("@suite/module-sdk/host-capabilities").HostCapabilityCall;
}
declare global {
  interface Window {
    suiteDesktop?: DesktopBridge;
  }
}
export function canReadSnapshot(
  snapshot: Snapshot | undefined,
  now = Date.now(),
): snapshot is Snapshot {
  return (
    !!snapshot &&
    snapshot.expiresAt > now &&
    snapshot.cachedAt <= now &&
    snapshot.bootstrap.offlineHours > 0
  );
}
export * from "./modules/features";
