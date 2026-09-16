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
  "snapshot" | "drafts" | "pending" | "module-state" | "relay-inbox";
export interface Snapshot {
  bootstrap: Bootstrap;
  products: Product[];
  orders: Order[];
  expiresAt: number;
  cachedAt: number;
}
export interface LocalDraft {
  id: string;
  input: DraftInput;
  remoteId?: string;
  baseVersion?: number;
  uploadKey: string;
  updatedAt: number;
  state: "local" | "conflict" | "uploading";
}
export interface PendingCommand {
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
  peers: { address: string; port: number; seen: number }[];
  port?: number;
}
export interface DesktopBridge {
  openBilling(url: string): Promise<void>;
  lanStatus(): Promise<LanStatus>;
  setLan(scope: Scope, enabled: boolean): Promise<LanStatus>;
  relay(
    scope: Scope,
    peerId: string,
    envelope: {
      kind: "artifact" | "pending";
      workspaceId: string;
      id: string;
      payload: string;
      digest: string;
    },
  ): Promise<void>;
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
export * from "./features";
