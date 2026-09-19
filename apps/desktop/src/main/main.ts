import { NativeInputRecovery } from "./input-recovery";
import { validateRecoveryInput } from "@suite/client/input-recovery";
import { assertWorkspacePurgeable } from "@suite/client/storage-retention";
import { downloadExport } from "./export-download";
import { createLocalDeviceHost } from "./local-devices";
import {
  ModuleHostSessions,
  validateModuleHostIdentity,
} from "./module-capabilities";
import {
  NativeCapabilityAuthority,
  CapabilityTransportUnavailable,
  isCapabilityTransportFailure,
} from "./capability-authority";
import { ManagedLanSession } from "./lan/session";
import { LanPackages } from "./lan/packages";
import { readArchive as validateArchive } from "./lan/receipts";
import { registerLanRecovery } from "./lan/ipc";
import { LanRecovery } from "./lan/recovery";
import {
  openCache,
  cacheRead,
  cacheWrite,
  cachePurge,
  cachePurgeWorkspace,
  cachePruneArtifacts,
  cacheVerifyLanPackage,
} from "../utility/cache-service";
import { randomBytes, createHash } from "node:crypto";
import {
  app,
  BrowserWindow,
  protocol,
  net,
  ipcMain,
  safeStorage,
  shell,
  dialog,
  Notification,
  autoUpdater,
  type IpcMainInvokeEvent,
} from "electron";
import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { resolve, sep, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { NativeCredentials } from "./identity/credentials";
import { nativeLoginCallback } from "./identity/callback";
import { NativeSignIn } from "./identity/sign-in";
import { randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import { assertSchema } from "@suite/module-sdk";
import {
  operationPath,
  type OperationRequest,
  type LoginOptions,
} from "@suite/contracts";
import {
  isModuleArtifactKey,
  type Scope,
  type CacheKey,
  type RememberedIdentity,
} from "@suite/client";
import {
  validateOperation,
  validateScope,
  trustedSender,
  validateLogin,
} from "./security";
declare const __RUNTIME_CONFIG__: {
  apiOrigin: string;
  issuer: string;
  clientId: string;
  audience: string;
  callback: string;
  updateUrl: string;
};
const config = __RUNTIME_CONFIG__;
const minimizedTest =
  !app.isPackaged && process.env.SUITE_DESKTOP_TEST_MINIMIZED === "1";
const devAuth =
  !app.isPackaged &&
  process.env.NODE_ENV === "development" &&
  process.env.SUITE_DESKTOP_DEV_AUTH === "1" &&
  ["localhost", "127.0.0.1"].includes(new URL(config.apiOrigin).hostname);
const oidcConfigured =
  !config.apiOrigin.includes(".invalid") &&
  config.issuer.startsWith("https://") &&
  !config.issuer.includes(".invalid") &&
  !!config.clientId &&
  !!config.audience;
let win: BrowserWindow | undefined;
let userId: string | undefined;
let identityEpoch = 0,
  identitySequence = 0;
const moduleHosts = new ModuleHostSessions(() => userId);
const localDeviceHosts = createLocalDeviceHost(() => win, minimizedTest);
let devCookie: string | undefined, csrfToken: string | undefined;
let updateRequired = false,
  updateReady = false,
  installing = false;
let oidcConfig: Promise<oidc.Configuration> | undefined;
const signInRequests = new NativeSignIn();
let logoutPromise: Promise<void> | undefined;
const credentials = new NativeCredentials({
  epoch: () => identityEpoch,
  load: () => readSecure<{ refreshToken?: string }>("credentials"),
  save: async (value) => {
    await writeSecure("credentials", value);
  },
  remove: async () => {
    volatile.delete("credentials");
    await rm(resolve(root(), "credentials.bin"), { force: true });
  },
  renew: async (token) => oidc.refreshTokenGrant(await client(), token),
});
const volatile = new Map<string, unknown>();
protocol.registerSchemesAsPrivileged([
  {
    scheme: "suite",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const secureAvailable = () =>
  safeStorage.isEncryptionAvailable() &&
  (process.platform !== "linux" ||
    safeStorage.getSelectedStorageBackend() !== "basic_text");
const root = () => resolve(app.getPath("userData"), "secure-cache");
const lanConfigured = (scope?: Scope) =>
  !!(
    process.env.SUITE_LAN_CERT &&
    process.env.SUITE_LAN_KEY &&
    process.env.SUITE_LAN_CA &&
    process.env.SUITE_LAN_PEERS &&
    process.env.SUITE_LAN_ADDRESSES &&
    process.env.SUITE_LAN_WORKSPACE &&
    (!scope || scope.workspaceId === process.env.SUITE_LAN_WORKSPACE)
  );
let lanChangePending = false;
const lan: ManagedLanSession = new ManagedLanSession({
  changed: () => {
    if (lanChangePending) return;
    lanChangePending = true;
    queueMicrotask(() => {
      lanChangePending = false;
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
        win.webContents.send("suite:lan-changed");
    });
  },
  retained: async (scope, envelope) => {
    await ensureCache();
    validateScope(scope, userId);
    const entries = validateArchive(
      await cacheRead(`${scope.userId}/${scope.workspaceId}/relay-archive`),
      scope,
    );
    const previous = entries.find((entry) => entry.envelope.id === envelope.id);
    if (!previous) return false;
    if (previous.envelope.digest !== envelope.digest)
      throw Error(
        "This relay identity already belongs to different archived content.",
      );
    return true;
  },
  receiveArtifact: (scope, envelope, check) =>
    lanPackages.receive(scope, envelope, check),
  currentUser: () => userId,
  authorizeModule: (scope, grant) => nativeAuthority.authorizeLan(scope, grant),
  authorize: async (scope) => {
    const result = await execute(
      {
        operation: "bootstrap",
        params: { workspaceId: scope.workspaceId },
      },
      4000,
    );
    if (result.status !== 200)
      throw Error("Workspace administrator access is required.");
    return result.body;
  },
  configure: async (scope) => {
    if (!lanConfigured(scope))
      throw Error(
        "Managed device certificates and peer policy must be configured first.",
      );
    return {
      key: await readFile(process.env.SUITE_LAN_KEY!, "utf8"),
      cert: await readFile(process.env.SUITE_LAN_CERT!, "utf8"),
      ca: await readFile(process.env.SUITE_LAN_CA!, "utf8"),
      workspaceId: scope.workspaceId,
      allowedPeers: process.env.SUITE_LAN_PEERS!.split(","),
      addresses: process.env.SUITE_LAN_ADDRESSES!.split(","),
      ports: [49180, 49181, 49182],
    };
  },
  readInbox: async (scope) => {
    await ensureCache();
    validateScope(scope, userId);
    return cacheRead(`${scope.userId}/${scope.workspaceId}/relay-inbox`);
  },
  writeInbox: async (scope, inbox) => {
    await ensureCache();
    validateScope(scope, userId);
    await cacheWrite(`${scope.userId}/${scope.workspaceId}/relay-inbox`, inbox);
  },
});
const lanStatus = (scope: Scope) => ({
  configured: lanConfigured(scope),
  ...lan.status(scope),
});
const lanRecovery = new LanRecovery({
  currentUser: () => userId,
  access: (scope) => nativeAuthority.lanRecoveryAccess(scope),
  readArchive: async (scope) => {
    await ensureCache();
    validateScope(scope, userId);
    return cacheRead(`${scope.userId}/${scope.workspaceId}/relay-archive`);
  },
  writeArchive: async (scope, entries) => {
    await ensureCache();
    validateScope(scope, userId);
    await cacheWrite(
      `${scope.userId}/${scope.workspaceId}/relay-archive`,
      entries,
    );
  },
  restore: (scope, envelope, check) => lan.restore(scope, envelope, check),
  request: (request) => execute(request, 8000),
  inbox: (scope) => lan.inbox(scope),
  dismiss: (scope, id, digest) => lan.dismiss(scope, id, digest),
  read: async (scope, id) => {
    await ensureCache();
    validateScope(scope, userId);
    return cacheRead(
      `${scope.userId}/${scope.workspaceId}/relay-receipts/${id}`,
    );
  },
  write: async (scope, id, value) => {
    await ensureCache();
    validateScope(scope, userId);
    await cacheWrite(
      `${scope.userId}/${scope.workspaceId}/relay-receipts/${id}`,
      value,
    );
  },
});
const packageCacheKey = (scope: Scope, key: string) =>
  `${scope.userId}/${scope.workspaceId}/relay-packages/${key}`;
const lanPackages: LanPackages = new LanPackages({
  currentUser: () => userId,
  request: (request) => execute(request, 8000),
  read: async (scope, key) => {
    await ensureCache();
    validateScope(scope, userId);
    return cacheRead(packageCacheKey(scope, key));
  },
  write: async (scope, key, value) => {
    await ensureCache();
    validateScope(scope, userId);
    await cacheWrite(packageCacheKey(scope, key), value);
  },
  prune: async (scope, keep) => {
    await ensureCache();
    validateScope(scope, userId);
    await cachePruneArtifacts(
      packageCacheKey(scope, ""),
      keep.map((key) => packageCacheKey(scope, key)),
    );
  },
  verify: async (scope, transfer, metadata, publicKey) => {
    await ensureCache();
    validateScope(scope, userId);
    return cacheVerifyLanPackage(
      packageCacheKey(scope, transfer.transfer),
      transfer,
      metadata,
      publicKey,
    );
  },
  readInbox: async (scope) => {
    await ensureCache();
    validateScope(scope, userId);
    return cacheRead(`${scope.userId}/${scope.workspaceId}/relay-inbox`);
  },
  dismiss: (scope, id, digest) => lan.dismiss(scope, id, digest),
});
let cacheReady: Promise<void> | undefined;
async function ensureCache() {
  return (cacheReady ??= (async () => {
    if (!secureAvailable()) throw Error("Protected storage is unavailable.");
    let secret = await readSecure<string>("cache-secret");
    if (!secret) {
      secret = randomBytes(32).toString("base64");
      await writeSecure("cache-secret", secret);
    }
    await mkdir(root(), { recursive: true, mode: 0o700 });
    await openCache(resolve(root(), "workspace.sqlite"), secret);
  })());
}
async function writeSecure(key: string, value: unknown) {
  if (!secureAvailable()) {
    volatile.set(key, value);
    return false;
  }
  if (key.includes("/")) {
    await ensureCache();
    await cacheWrite(key, value);
    return true;
  }
  const path = resolve(root(), key + ".bin");
  if (!path.startsWith(root() + sep)) throw Error("Invalid storage key");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, encrypted, { mode: 0o600 });
  await rename(temp, path);
  return true;
}
async function readSecure<T>(key: string): Promise<T | undefined> {
  if (!secureAvailable()) return volatile.get(key) as T | undefined;
  if (key.includes("/")) {
    await ensureCache();
    const value = await cacheRead(key);
    if (value !== undefined) return value as T;
  }
  try {
    const result = await safeStorage.decryptStringAsync(
      await readFile(resolve(root(), key + ".bin")),
    );
    return JSON.parse(result.result) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw Error("Protected storage could not be unlocked. Sign in again.");
  }
}
const authorityHost: ConstructorParameters<
  typeof NativeCapabilityAuthority
>[0] = {
  issuer: new URL(config.apiOrigin).origin,
  currentUser: () => userId,
  available: secureAvailable,
  request: (request) => execute(request, 4000),
  read: async (key) => {
    await ensureCache();
    return cacheRead(key);
  },
  write: async (key, value) => {
    if (!secureAvailable()) throw Error("Protected storage is unavailable.");
    await ensureCache();
    await cacheWrite(key, value);
  },
  purge: async (prefix) => {
    await ensureCache();
    await cachePurge(prefix);
  },
};
const nativeAuthority = new NativeCapabilityAuthority(authorityHost);
const inputRecovery = new NativeInputRecovery(authorityHost);

function sender(event: IpcMainInvokeEvent) {
  if (
    event.sender !== win?.webContents ||
    !event.senderFrame ||
    event.senderFrame !== win.webContents.mainFrame ||
    !trustedSender(event.senderFrame.url)
  )
    throw Error("Untrusted sender");
}
function cacheKey(scope: Scope, key: CacheKey) {
  validateScope(scope, userId);
  if (
    !scope.workspaceId ||
    (!isModuleArtifactKey(key) &&
      ![
        "snapshot",
        "drafts",
        "pending",
        "module-state",
        "workspace-authority",
      ].includes(key))
  )
    throw Error("Invalid cache key");
  return `${scope.userId}/${scope.workspaceId}/${key}`;
}
async function client() {
  if (!oidcConfigured)
    throw Error(
      "Configure the Auth0 native client and rebuild the desktop app.",
    );
  return (oidcConfig ??= oidc.discovery(
    new URL(config.issuer),
    config.clientId,
  ));
}
async function ensureToken() {
  if (!devAuth) await credentials.ensure();
}
async function execute(raw: OperationRequest, timeoutMs?: number) {
  const actor = userId;
  const validated = validateOperation(raw);
  const epoch = identityEpoch;
  const sequence =
    validated.operation === "me" ? ++identitySequence : undefined;
  const current = () =>
    validated.operation === "connection" ||
    (epoch === identityEpoch &&
      (sequence === undefined || sequence === identitySequence));
  const stale = () => ({
    status: 401,
    body: {
      code: "PROFILE_CHANGED",
      message: "The profile changed while this request was running.",
    },
  });
  const request = {
    ...validated,
    expectedUserId:
      validated.expectedUserId ??
      (validated.operation === "me" || validated.operation === "connection"
        ? undefined
        : actor),
  };
  const op = operationPath(request);
  const recoveryRevision =
    actor && request.params?.workspaceId
      ? inputRecovery.revision({
          userId: actor,
          workspaceId: request.params.workspaceId,
        })
      : undefined;
  if (request.operation === "connection") {
    const response = await fetch(config.apiOrigin + op.path, {
      signal: AbortSignal.timeout(4000),
    });
    return { status: response.status, body: await response.json() };
  }
  if (
    updateRequired &&
    !["me", "bootstrap", "logout", "orderGet"].includes(request.operation)
  )
    return {
      status: 426,
      body: {
        code: "UPDATE_REQUIRED",
        message: "Update Common to continue. Your local drafts are preserved.",
      },
    };
  try {
    await ensureToken();
  } catch (error) {
    if (!current()) return stale();
    if (isCapabilityTransportFailure(error))
      throw new CapabilityTransportUnavailable("The API cannot be reached.");
    if (actor) await writeSecure(`${actor}/account-revision`, randomUUID());
    return {
      status: 401,
      body: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
    };
  }
  const headers: Record<string, string> = {
    "X-Desktop-Version": app.getVersion(),
  };
  if (devAuth && devCookie) {
    headers.Cookie = devCookie;
    headers.Origin = config.apiOrigin.replace(":4310", ":4300");
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  } else headers.Authorization = `Bearer ${credentials.accessToken}`;
  if (!current()) return stale();
  if (request.expectedUserId) headers["X-Suite-Actor"] = request.expectedUserId;
  if (request.body !== undefined) headers["Content-Type"] = "application/json";
  if (request.idempotencyKey)
    headers["Idempotency-Key"] = request.idempotencyKey;
  if (request.moduleVersion !== undefined)
    headers["X-Module-Version"] = request.moduleVersion;
  if (request.version !== undefined)
    headers["If-Match"] = `"${request.version}"`;
  const res = await fetch(config.apiOrigin + op.path, {
    method: op.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    signal: AbortSignal.timeout(
      request.operation === "installationReport" ? 2000 : (timeoutMs ?? 20000),
    ),
    redirect: "error",
  }).catch((error: unknown) => {
    if (isCapabilityTransportFailure(error))
      throw new CapabilityTransportUnavailable("The API cannot be reached.");
    throw error;
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!current()) return stale();
  const authenticatedActor = res.headers.get("x-suite-actor") ?? undefined;
  if (
    res.ok &&
    request.expectedUserId &&
    authenticatedActor !== request.expectedUserId
  ) {
    if (actor) await writeSecure(`${actor}/account-revision`, randomUUID());
    return {
      status: 401,
      actorId: authenticatedActor,
      body: {
        code: "PROFILE_CHANGED",
        message: "The response did not confirm the requested profile.",
      },
    };
  }
  if (res.status === 426) updateRequired = true;
  if (request.operation === "me" && res.ok) {
    const user = body.user as { id: string };
    if (!authenticatedActor || user.id !== authenticatedActor) return stale();
    if (userId && userId !== user.id) {
      await writeSecure(`${userId}/account-revision`, randomUUID());
      lanRecovery.invalidate();
      lanPackages.invalidate();
      void lan.stop().catch(() => {});
    }
    if (!current()) return stale();
    if (userId !== user.id) identityEpoch++;
    userId = user.id;
    csrfToken = body.csrfToken as string | undefined;
  }
  if (actor && actor === userId && secureAvailable()) {
    const workspaceId = request.params?.workspaceId;
    if (workspaceId) {
      const scope = { userId: actor, workspaceId };
      try {
        if (res.ok && request.operation === "bootstrap") {
          await nativeAuthority.observe(scope, body);
          lan.observe(scope, body);
        } else if (res.ok && request.operation === "workspacePolicy") {
          await nativeAuthority.observe(scope, body.bootstrap);
          lan.observe(scope, body.bootstrap);
        } else if ([401, 403, 426].includes(res.status)) {
          void lan.stop(scope).catch(() => {});
          await nativeAuthority.revoke(scope);
        }
      } catch {
        void lan.stop(scope).catch(() => {});
        await nativeAuthority.revoke(scope).catch(() => {});
      }
      // Recovery owns its metadata ordering; genuine server denial still revokes access.
      await inputRecovery.observeResponse(
        scope,
        request.operation,
        { status: res.status, body },
        recoveryRevision,
      );
    }
    if (res.status === 401) {
      await writeSecure(`${actor}/account-revision`, randomUUID());
      void lan.stop().catch(() => {});
      moduleHosts.clear();
      await nativeAuthority.purge({ userId: actor });
      await inputRecovery.purge({ userId: actor });
    }
  }
  return {
    status: res.status,
    body,
    actorId: res.headers.get("x-suite-actor") ?? undefined,
  };
}
async function login(options: LoginOptions, signal: AbortSignal) {
  const epoch = ++identityEpoch;
  let ownedEpoch = epoch;
  const previousUser = userId;
  userId = undefined;
  devCookie = csrfToken = undefined;
  try {
    await credentials.clear();
    if (previousUser)
      await writeSecure(`${previousUser}/account-revision`, randomUUID());
    await rm(resolve(root(), "identity.bin"), { force: true });
    signal.throwIfAborted();
    if (devAuth) {
      const result = await fetch(config.apiOrigin + "/auth/development", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@demo.local" }),
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      }).catch(() => {
        throw Error("The local API is unavailable. Start it and try again.");
      });
      if (!result.ok)
        throw Error("Start the local API and seed its demonstration accounts.");
      signal.throwIfAborted();
      if (epoch !== identityEpoch)
        throw Error("The authentication session changed.");
      devCookie = result.headers
        .getSetCookie()
        .find((c) => c.startsWith("suite_session="))
        ?.split(";")[0];
      if (!devCookie)
        throw Error(
          "The local API did not create a session. Try signing in again.",
        );
      const me = await execute({ operation: "me" });
      if (me.status === 200) ownedEpoch = identityEpoch;
      signal.throwIfAborted();
      if (me.status !== 200)
        throw Error(
          "The local session could not be verified. Try signing in again.",
        );
      return;
    }
    const c = await client(),
      verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce();
    signal.throwIfAborted();
    await nativeLoginCallback({
      callback: new URL(config.callback),
      state,
      signal: signal,
      exchange: async (url, signal) => {
        const tokens = await oidc.authorizationCodeGrant(c, url, {
          pkceCodeVerifier: verifier,
          expectedState: state,
          expectedNonce: nonce,
          idTokenExpected: true,
        });
        signal.throwIfAborted();
        await credentials.commit(tokens, epoch, "login", signal);
        signal.throwIfAborted();
        const result = await execute({ operation: "me" });
        if (result.status === 200) ownedEpoch = identityEpoch;
        signal.throwIfAborted();
        if (result.status !== 200)
          throw Error("The API could not verify this account");
      },
      open: async (signal) => {
        const challenge = await oidc.calculatePKCECodeChallenge(verifier);
        signal.throwIfAborted();
        const url = oidc.buildAuthorizationUrl(c, {
          ...(options.loginHint ? { login_hint: options.loginHint } : {}),
          ...(options.screenHint
            ? { screen_hint: options.screenHint, prompt: "login" }
            : {}),
          redirect_uri: config.callback,
          scope: "openid profile email offline_access",
          audience: config.audience,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
          nonce,
          acr_values:
            "http://schemas.openid.net/pape/policies/2007/06/multi-factor",
        });
        await shell.openExternal(url.toString());
      },
    });
    signal.throwIfAborted();
    if (!minimizedTest) {
      win?.show();
      win?.focus();
    }
  } catch (error) {
    // Logout owns cleanup after advancing the epoch; an older failed attempt
    // must never remove a newer session's credentials.
    if (ownedEpoch === identityEpoch) {
      identityEpoch++;
      userId = undefined;
      devCookie = csrfToken = undefined;
      await credentials.clear();
    }
    throw error;
  }
}

function handlers() {
  localDeviceHosts.register(sender);
  ipcMain.handle(
    "suite:module-offline",
    async (
      event,
      scope: Scope,
      moduleId: string,
      version: string,
      enabled: boolean,
    ) => {
      sender(event);
      validateScope(scope, userId);
      validateModuleHostIdentity(scope, moduleId, version);
      if (typeof enabled !== "boolean")
        throw Error("Invalid offline preference.");
      return nativeAuthority.prepare(scope, moduleId, version, enabled);
    },
  );
  ipcMain.handle(
    "suite:module-host-open",
    (event, scope: Scope, moduleId: string, version: string) => {
      sender(event);
      validateScope(scope, userId);
      return moduleHosts.open(scope, moduleId, version);
    },
  );
  ipcMain.handle("suite:module-host-close", (event, handle) => {
    sender(event);
    moduleHosts.close(handle);
  });
  ipcMain.handle(
    "suite:module-capability",
    async (event, handle, capability, input) => {
      sender(event);
      let reauthorize: (() => Promise<unknown>) | undefined;
      return moduleHosts
        .execute(handle, capability, input, {
          authorize: async (scope, call) => {
            if (reauthorize) return reauthorize();
            const prepared = await nativeAuthority.authorize(scope, call);
            reauthorize = prepared.recheck;
            return prepared.authorization;
          },
          invoke: async (authorization, input, recheck) => {
            if (authorization.kind === "files.export") {
              const value = input as { filename: string; content: string };
              const result = await dialog.showSaveDialog(win!, {
                defaultPath: value.filename,
                filters: [
                  {
                    name: "Module export",
                    extensions: [value.filename.split(".").at(-1)!],
                  },
                ],
              });
              if (result.canceled || !result.filePath)
                return { status: "cancelled" };
              await recheck();
              await writeFile(result.filePath, value.content, { mode: 0o600 });
              return { status: "saved" };
            }
            if (authorization.kind === "notifications.show") {
              const value = input as { title: string; message: string };
              if (!Notification.isSupported()) return { requested: false };
              await recheck();
              new Notification({
                title: value.title,
                body: value.message,
              }).show();
              return { requested: true };
            }
            const scope = {
              userId: authorization.userId,
              workspaceId: authorization.workspaceId,
            };
            if (authorization.kind === "lan.status") {
              const status = lan.status(scope);
              return {
                enabled: status.enabled,
                configured: lanConfigured(scope),
                peers: status.peers,
              };
            }
            const value = input as {
              peerId: string;
              kind: "artifact" | "pending";
              id: string;
              payload: string;
            };
            const payload = JSON.parse(value.payload);
            if (
              value.kind === "artifact"
                ? payload.module_id !== authorization.moduleId
                : payload.call?.moduleId !== authorization.moduleId ||
                  payload.workspaceId !== authorization.workspaceId ||
                  payload.userId !== authorization.userId
            )
              throw Error(
                "Relay content must belong to this module and workspace.",
              );
            const digest = createHash("sha256")
              .update(value.payload)
              .digest("hex");
            await lan.relay(
              scope,
              value.peerId,
              {
                kind: value.kind,
                id: value.id,
                payload: value.payload,
                workspaceId: authorization.workspaceId,
                digest,
              },
              recheck,
            );
            return { relayed: true, authoritative: false };
          },
        })
        .then(
          (result) => ({ ok: true, result }),
          (error) => ({
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : "The host action failed.",
          }),
        );
    },
  );
  ipcMain.handle("suite:billing-open", async (event, value: unknown) => {
    sender(event);
    if (typeof value !== "string" || value.length > 4096)
      throw Error("Invalid billing destination.");
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
    )
      throw Error("Invalid billing destination.");
    await shell.openExternal(url.href);
  });
  ipcMain.handle(
    "suite:lan-package",
    (
      event,
      scope: Scope,
      selection: import("@suite/module-sdk/platform").InstallationSelection,
    ) => {
      sender(event);
      validateScope(scope, userId);
      return lanPackages.get(scope, selection);
    },
  );
  ipcMain.handle(
    "suite:lan-package-ack",
    (event, scope: Scope, transferId: string) => {
      sender(event);
      validateScope(scope, userId);
      return lanPackages.acknowledge(scope, transferId);
    },
  );
  registerLanRecovery(lanRecovery, {
    sender,
    validateScope: (scope) => validateScope(scope, userId),
    window: () => win!,
  });
  ipcMain.handle("suite:lan-status", async (event, scope: Scope) => {
    sender(event);
    validateScope(scope, userId);
    await lan.refresh(scope);
    return lanStatus(scope);
  });
  ipcMain.handle(
    "suite:lan-set",
    async (
      event,
      scope: Scope,
      enabled: boolean,
      grant?: import("@suite/client").LanModuleGrant,
    ) => {
      sender(event);
      validateScope(scope, userId);
      if (typeof enabled !== "boolean") throw Error("Invalid network setting.");
      if (
        grant !== undefined &&
        (!grant ||
          typeof grant !== "object" ||
          Array.isArray(grant) ||
          Object.keys(grant).some(
            (key) => !["moduleId", "moduleVersion", "capability"].includes(key),
          ) ||
          [grant.moduleId, grant.moduleVersion, grant.capability].some(
            (value) =>
              typeof value !== "string" || !value.length || value.length > 128,
          ))
      )
        throw Error("Invalid module network grant.");
      if (enabled) await lan.enable(scope, grant);
      else await lan.stop(scope);
      return lanStatus(scope);
    },
  );
  ipcMain.handle("suite:auth-status", (event) => {
    sender(event);
    return {
      mode: devAuth ? "development" : oidcConfigured ? "oidc" : "unconfigured",
    };
  });
  ipcMain.handle("suite:execute", (event, request) => {
    sender(event);
    return execute(request);
  });
  ipcMain.handle("suite:login", (event, value) => {
    sender(event);
    const options = validateLogin(value);
    return signInRequests.run(async (signal) => {
      await logoutPromise;
      signal.throwIfAborted();
      moduleHosts.clear();
      nativeAuthority.clear();
      inputRecovery.clear();
      localDeviceHosts.clear();
      lanRecovery.invalidate();
      lanPackages.invalidate();
      await lan.stop();
      signal.throwIfAborted();
      await login(options, signal);
    });
  });
  ipcMain.handle("suite:logout", (event) => {
    sender(event);
    return (logoutPromise ??= (async () => {
      identityEpoch++;
      signInRequests.cancel();
      moduleHosts.clear();
      localDeviceHosts.clear();
      const token = credentials.refreshToken,
        previousUser = userId;
      userId = undefined;
      devCookie = csrfToken = undefined;
      // Clear memory immediately; serialize durable deletion behind earlier writes.
      const clearingCredentials = credentials.clear();
      void clearingCredentials.catch(() => {});
      lanRecovery.invalidate();
      lanPackages.invalidate();
      try {
        if (previousUser)
          await writeSecure(`${previousUser}/account-revision`, randomUUID());
        if (previousUser && secureAvailable()) {
          await nativeAuthority.purge({ userId: previousUser });
          await inputRecovery.purge({ userId: previousUser });
        } else {
          nativeAuthority.clear();
          inputRecovery.clear();
        }
        await lan.stop();
      } finally {
        // Session removal is separate from the encrypted account's business data.
        await clearingCredentials;
        await rm(resolve(root(), "identity.bin"), { force: true });
        volatile.clear();
      }
      if (token && config.issuer)
        await fetch(new URL("oauth/revoke", config.issuer), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: config.clientId, token }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => undefined);
    })().finally(() => {
      logoutPromise = undefined;
    }));
  });
  ipcMain.handle("suite:account-revision", async (event, accountId) => {
    sender(event);
    validateScope({ userId: accountId }, userId);
    return (
      (await readSecure<string>(`${accountId}/account-revision`)) ?? "initial"
    );
  });
  ipcMain.handle("suite:cache-read", (event, scope, key) => {
    sender(event);
    return readSecure(cacheKey(scope, key));
  });
  ipcMain.handle("suite:cache-write", async (event, scope, key, value) => {
    sender(event);
    const path = cacheKey(scope, key);
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 2 * 1024 * 1024)
      throw Error("Offline storage size limit reached.");
    if (!secureAvailable() && key !== "pending")
      throw Error(
        "Protected storage is unavailable. Use session-only mode on this device.",
      );
    await writeSecure(path, value);
    if (key === "snapshot")
      await inputRecovery.setOffline(
        scope,
        typeof value?.expiresAt === "number" && value.expiresAt > 0,
      );
  });
  ipcMain.handle("suite:cache-prune-artifacts", async (event, scope, keep) => {
    sender(event);
    cacheKey(scope, "module-state");
    if (
      !Array.isArray(keep) ||
      keep.length > 65536 ||
      !keep.every(isModuleArtifactKey)
    )
      throw Error("Invalid artifact retention list");
    await ensureCache();
    await cachePruneArtifacts(
      `${scope.userId}/${scope.workspaceId}/module-artifact/`,
      keep.map((k) => `${scope.userId}/${scope.workspaceId}/${k}`),
    );
  });
  ipcMain.handle("suite:cache-purge", async (event, scope) => {
    sender(event);
    validateScope(scope, userId);
    const path = scope.workspaceId
      ? `${scope.userId}/${scope.workspaceId}`
      : scope.userId;
    if (scope.workspaceId) {
      if (!secureAvailable())
        throw Error(
          "Protected storage is unavailable. Unlock it before removing offline data.",
        );
      // Include retained legacy files and volatile online retry identities; the
      // utility process independently checks current database rows atomically.
      assertWorkspacePurgeable({
        drafts: await readSecure(`${path}/drafts`),
        pending: await readSecure(`${path}/pending`),
        modules: await readSecure(`${path}/module-state`),
      });
      assertWorkspacePurgeable({ pending: volatile.get(`${path}/pending`) });
      validateScope(scope, userId);
    }
    if (secureAvailable()) {
      await ensureCache();
      if (scope.workspaceId) await cachePurgeWorkspace(path);
      else await cachePurge(path);
      await nativeAuthority.purge(scope);
      await inputRecovery.purge(scope);
    }
    await rm(resolve(root(), path), { recursive: true, force: true });
    for (const key of volatile.keys())
      if (key.startsWith(path + "/")) volatile.delete(key);
  });
  ipcMain.handle("suite:identity", (event) => {
    sender(event);
    return readSecure<RememberedIdentity>("identity");
  });
  ipcMain.handle(
    "suite:remember",
    async (event, identity: RememberedIdentity | undefined) => {
      sender(event);
      if (identity) {
        validateScope(identity, userId);
        if (typeof identity.name !== "string" || identity.name.length > 200)
          throw Error("Invalid profile");
        await writeSecure("identity", identity);
      } else {
        await rm(resolve(root(), "identity.bin"), { force: true });
        volatile.delete("identity");
      }
    },
  );
  ipcMain.handle(
    "suite:export-download",
    async (event, handle: string, id: string) => {
      sender(event);
      try {
        const session = moduleHosts.capture(handle);
        if (session.moduleId !== "orders")
          throw Error("This module does not own Orders exports.");
        const scope = session.scope;
        const result = await downloadExport(scope, id, {
          check: () => {
            sender(event);
            validateScope(scope, userId);
            session.check();
          },
          request: execute,
          choose: async (filename) => {
            const result = await dialog.showSaveDialog(win!, {
              defaultPath: filename,
              filters: [{ name: "CSV export", extensions: ["csv"] }],
            });
            return result.canceled ? undefined : result.filePath;
          },
          write: (path, content) => writeFile(path, content, { mode: 0o600 }),
        });
        return { ok: true, result };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "The export could not be saved.",
        };
      }
    },
  );
  ipcMain.handle("suite:save-file", (event) => {
    sender(event);
    throw Error("Use the scoped recovery export action.");
  });
  ipcMain.handle("suite:input-export", async (event, handle, value) => {
    sender(event);
    const session = moduleHosts.capture(handle);
    const input = validateRecoveryInput(value, session.scope, session.moduleId);
    if (input.moduleVersion !== session.moduleVersion)
      throw Error("The recovery release does not match this session.");
    const content = JSON.stringify(input, null, 2);
    if (Buffer.byteLength(content, "utf8") > 20 * 1024 * 1024)
      throw Error("Recovery export size limit exceeded.");
    const check = () => {
      sender(event);
      session.check();
    };
    await inputRecovery.authorize(session.scope, input, check);
    check();
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `${input.kind === "module-work-recovery" ? "saved-work" : "module-input"}-${randomUUID()}.json`,
      filters: [{ name: "Module input recovery", extensions: ["json"] }],
    });
    check();
    if (result.canceled || !result.filePath) return;
    await inputRecovery.authorize(session.scope, input, check);
    check();
    await writeFile(result.filePath, content, { mode: 0o600 });
  });
  ipcMain.handle("suite:notify", (event, title, message) => {
    sender(event);
    if (
      typeof title !== "string" ||
      typeof message !== "string" ||
      title.length > 200 ||
      message.length > 500
    )
      throw Error("Invalid notification");
    if (Notification.isSupported())
      new Notification({ title, body: message }).show();
  });
  ipcMain.handle("suite:security-status", (event) => {
    sender(event);
    return {
      persistentStorage: secureAvailable(),
      updateRequired,
      developmentAuth: devAuth,
    };
  });
}
async function start() {
  if (devAuth && !app.commandLine.hasSwitch("user-data-dir")) {
    const profile = resolve(app.getPath("appData"), "Common Development");
    mkdirSync(profile, { recursive: true });
    app.setPath("userData", profile);
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();
  if (app.isPackaged && !config.apiOrigin.startsWith("https://")) {
    await dialog.showMessageBox({
      type: "error",
      message: "Production desktop builds require an HTTPS API origin.",
    });
    app.quit();
    return;
  }
  try {
    await credentials.restore();
    userId = (await readSecure<RememberedIdentity>("identity"))?.userId;
  } catch {
    /* A locked keychain leaves sign-in available without leaking plaintext. */
  }
  const assetRoot = resolve(__dirname, "renderer");
  protocol.handle("suite", (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "app")
      return new Response("Not found", { status: 404 });
    let path: string;
    try {
      path = resolve(
        assetRoot,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
    } catch {
      return new Response("Invalid path", { status: 400 });
    }
    if (!path.startsWith(assetRoot + sep))
      return new Response("Forbidden", { status: 403 });
    return net.fetch(pathToFileURL(path).toString());
  });
  handlers();
  const createWindow = () => {
    if (minimizedTest) app.dock?.hide();
    win = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 380,
      minHeight: 600,
      title: devAuth ? "Common Local" : "Common",
      show: false,
      backgroundColor: process.platform === "darwin" ? "#00000000" : "#25251f",
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hidden" as const,
            trafficLightPosition: { x: 14, y: 20 },
            vibrancy: "under-window" as const,
            visualEffectState: "followWindow" as const,
          }
        : {}),
      webPreferences: {
        preload: resolve(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        devTools: !app.isPackaged,
        backgroundThrottling: !minimizedTest,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on(
      "did-start-navigation",
      (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
          moduleHosts.clear();
          localDeviceHosts.clear();
        }
      },
    );
    const closeViewSessions = () => {
      moduleHosts.clear();
      localDeviceHosts.clear();
    };
    win.webContents.on("render-process-gone", closeViewSessions);
    win.webContents.on("destroyed", closeViewSessions);
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler(
      (_wc, _permission, callback) => callback(false),
    );
    win.webContents.session.setPermissionCheckHandler(() => false);
    win.webContents.session.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'",
          ],
        },
      }),
    );
    win.once("ready-to-show", () => {
      if (minimizedTest) win?.minimize();
      else win?.show();
    });
    void win.loadURL("suite://app/index.html");
  };
  createWindow();
  app.on("second-instance", () => {
    if (!minimizedTest) {
      win?.show();
      win?.focus();
    }
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  if (
    config.updateUrl.startsWith("https://") &&
    process.platform !== "linux" &&
    app.isPackaged
  ) {
    autoUpdater.setFeedURL({ url: config.updateUrl });
    autoUpdater.on("update-downloaded", () => {
      updateReady = true;
    });
    autoUpdater.on("error", () => {
      /* Update errors leave the current signed version available. */
    });
    void autoUpdater.checkForUpdates();
  }
  app.on("before-quit", (event) => {
    if (updateReady && !installing) {
      event.preventDefault();
      installing = true;
      autoUpdater.quitAndInstall();
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
void start().catch(async (error) => {
  await dialog.showMessageBox({
    type: "error",
    message: "Common could not start.",
    detail: error instanceof Error ? error.message : "Unknown startup error",
  });
  app.quit();
});
