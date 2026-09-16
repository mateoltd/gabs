import { LanTransport, type RelayEnvelope } from "./lan";
import {
  openCache,
  cacheRead,
  cacheWrite,
  cachePurge,
  cachePruneArtifacts,
} from "./cache-service";
import { randomBytes } from "node:crypto";
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
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import * as oidc from "openid-client";
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
} from "@suite/platform";
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
let accessToken: string | undefined,
  refreshToken: string | undefined,
  expiresAt = 0,
  devCookie: string | undefined,
  csrfToken: string | undefined;
let updateRequired = false,
  updateReady = false,
  installing = false,
  refreshing: Promise<void> | undefined;
let oidcConfig: Promise<oidc.Configuration> | undefined;
let loginPromise: Promise<void> | undefined;
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
let lan: LanTransport | undefined,
  lanScope: Scope | undefined,
  lanExpiry = 0;
const lanConfigured = () =>
  !!(
    process.env.SUITE_LAN_CERT &&
    process.env.SUITE_LAN_KEY &&
    process.env.SUITE_LAN_CA &&
    process.env.SUITE_LAN_PEERS &&
    process.env.SUITE_LAN_ADDRESSES
  );
const lanStatus = () => ({
  configured: lanConfigured(),
  workspaceId: lanScope?.workspaceId,
  ...(lan?.status() ?? { enabled: false, peers: [] }),
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
        "relay-inbox",
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
async function storeTokens(tokens: oidc.TokenEndpointResponse) {
  accessToken = tokens.access_token;
  expiresAt = Date.now() + (tokens.expires_in ?? 300) * 1000;
  refreshToken = tokens.refresh_token ?? refreshToken;
  await writeSecure("credentials", { refreshToken });
}
async function ensureToken() {
  if (devAuth) return;
  if (accessToken && expiresAt > Date.now() + 30000) return;
  if (!refreshToken) throw Error("Sign in to continue.");
  refreshing ??= (async () => {
    await storeTokens(
      await oidc.refreshTokenGrant(await client(), refreshToken!),
    );
  })();
  try {
    await refreshing;
  } finally {
    refreshing = undefined;
  }
}
async function execute(raw: OperationRequest) {
  const request = validateOperation(raw);
  const op = operationPath(request);
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
  } catch {
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
  } else headers.Authorization = `Bearer ${accessToken}`;
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
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (res.status === 426) updateRequired = true;
  if (request.operation === "me" && res.ok) {
    const user = body.user as { id: string };
    userId = user.id;
    csrfToken = body.csrfToken as string | undefined;
  }
  return { status: res.status, body };
}
async function login(options: LoginOptions) {
  if (devAuth) {
    const result = await fetch(config.apiOrigin + "/auth/development", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "owner@demo.local" }),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    }).catch(() => {
      throw Error("The local API is unavailable. Start it and try again.");
    });
    if (!result.ok)
      throw Error("Start the local API and seed its demonstration accounts.");
    devCookie = result.headers
      .getSetCookie()
      .find((c) => c.startsWith("suite_session="))
      ?.split(";")[0];
    if (!devCookie)
      throw Error(
        "The local API did not create a session. Try signing in again.",
      );
    const me = await execute({ operation: "me" });
    if (me.status !== 200) {
      devCookie = undefined;
      throw Error(
        "The local session could not be verified. Try signing in again.",
      );
    }
    return;
  }
  const c = await client(),
    verifier = oidc.randomPKCECodeVerifier(),
    state = oidc.randomState(),
    nonce = oidc.randomNonce();
  const callback = new URL(config.callback);
  if (
    callback.protocol !== "http:" ||
    callback.hostname !== "127.0.0.1" ||
    !callback.port
  )
    throw Error("Use a registered 127.0.0.1 callback with a fixed port.");
  await new Promise<void>((resolveLogin, reject) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      server.close();
      error ? reject(error) : resolveLogin();
    };
    const server = createServer((req, res) => {
      void (async () => {
        try {
          const url = new URL(req.url ?? "/", config.callback);
          if (
            req.method !== "GET" ||
            url.pathname !== callback.pathname ||
            url.searchParams.get("state") !== state
          ) {
            res.writeHead(400);
            res.end("Invalid callback");
            return;
          }
          const tokens = await oidc.authorizationCodeGrant(c, url, {
            pkceCodeVerifier: verifier,
            expectedState: state,
            expectedNonce: nonce,
            idTokenExpected: true,
          });
          await storeTokens(tokens);
          const result = await execute({ operation: "me" });
          if (result.status !== 200)
            throw Error("The API could not verify this account");
          res.writeHead(200, {
            "Content-Type": "text/html",
            "Content-Security-Policy": "default-src 'none'",
          });
          res.end("<h1>Signed in</h1><p>You can return to Common.</p>");
          win?.show();
          win?.focus();
          finish();
        } catch (e) {
          res.writeHead(400);
          res.end("Sign-in failed. Return to Common and try again.");
          finish(e as Error);
        }
      })();
    });
    const timer = setTimeout(
      () => finish(Error("Sign-in timed out. Try again.")),
      180000,
    );
    server.once("error", (e) =>
      finish(
        new Error(`Unable to open the registered login callback: ${e.message}`),
      ),
    );
    server.listen(Number(callback.port), "127.0.0.1", () => {
      void (async () => {
        const url = oidc.buildAuthorizationUrl(c, {
          ...(options.loginHint ? { login_hint: options.loginHint } : {}),
          ...(options.screenHint
            ? { screen_hint: options.screenHint, prompt: "login" }
            : {}),
          redirect_uri: config.callback,
          scope: "openid profile email offline_access",
          audience: config.audience,
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: "S256",
          state,
          nonce,
          acr_values:
            "http://schemas.openid.net/pape/policies/2007/06/multi-factor",
        });
        await shell.openExternal(url.toString());
      })().catch((e) => finish(e));
    });
  });
}
function handlers() {
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
  ipcMain.handle("suite:lan-status", (event) => {
    sender(event);
    return lanStatus();
  });
  ipcMain.handle(
    "suite:lan-set",
    async (event, scope: Scope, enabled: boolean) => {
      sender(event);
      validateScope(scope, userId);
      if (typeof enabled !== "boolean") throw Error("Invalid network setting.");
      if (lan) await lan.stop();
      lan = undefined;
      lanScope = undefined;
      if (!enabled) return lanStatus();
      if (!lanConfigured())
        throw Error(
          "Managed device certificates and peer policy must be configured first.",
        );
      const result = await execute({
        operation: "bootstrap",
        params: { workspaceId: scope.workspaceId },
      });
      const bootstrap = result.body as import("@suite/contracts").Bootstrap;
      if (
        result.status !== 200 ||
        !bootstrap.permissions.includes("modules.manage") ||
        !bootstrap.offlineHours
      )
        throw Error(
          "Workspace administrator access and an offline lease are required.",
        );
      lanScope = scope;
      lanExpiry =
        new Date(bootstrap.authorizedAt).getTime() +
        bootstrap.offlineHours * 3600000;
      lan = new LanTransport(
        {
          key: await readFile(process.env.SUITE_LAN_KEY!, "utf8"),
          cert: await readFile(process.env.SUITE_LAN_CERT!, "utf8"),
          ca: await readFile(process.env.SUITE_LAN_CA!, "utf8"),
          workspaceId: scope.workspaceId,
          allowedPeers: process.env.SUITE_LAN_PEERS!.split(","),
          addresses: process.env.SUITE_LAN_ADDRESSES!.split(","),
          ports: [49180, 49181, 49182],
        },
        async (envelope) => {
          if (Date.now() >= lanExpiry)
            throw Error("Local network authorization expired.");
          const key = cacheKey(scope, "relay-inbox");
          const inbox = (await readSecure<RelayEnvelope[]>(key)) ?? [];
          if (!inbox.some((e) => e.id === envelope.id)) {
            if (inbox.length >= 10) throw Error("Relay inbox is full.");
            await writeSecure(key, [...inbox, envelope]);
          }
        },
      );
      await lan.start();
      return lanStatus();
    },
  );
  ipcMain.handle(
    "suite:lan-relay",
    async (event, scope: Scope, peerId: string, envelope: RelayEnvelope) => {
      sender(event);
      validateScope(scope, userId);
      if (
        !lan ||
        lanScope?.workspaceId !== scope.workspaceId ||
        Date.now() >= lanExpiry
      )
        throw Error("Local network authorization expired.");
      if (
        !envelope ||
        envelope.workspaceId !== scope.workspaceId ||
        !["artifact", "pending"].includes(envelope.kind) ||
        typeof envelope.payload !== "string" ||
        envelope.payload.length > 200000
      )
        throw Error("Invalid relay envelope.");
      await lan.relay(peerId, envelope);
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
  ipcMain.handle("suite:login", async (event, value) => {
    sender(event);
    const options = validateLogin(value);
    loginPromise ??= login(options);
    try {
      await loginPromise;
    } finally {
      loginPromise = undefined;
    }
  });
  ipcMain.handle("suite:logout", async (event) => {
    sender(event);
    const token = refreshToken;
    if (lan) await lan.stop();
    lan = undefined;
    lanScope = undefined;
    accessToken = refreshToken = devCookie = csrfToken = undefined;
    expiresAt = 0;
    if (userId) {
      if (secureAvailable()) {
        await ensureCache();
        await cachePurge(userId);
      }
      await rm(resolve(root(), userId), { recursive: true, force: true });
    }
    await rm(resolve(root(), "credentials.bin"), { force: true });
    await rm(resolve(root(), "identity.bin"), { force: true });
    volatile.clear();
    userId = undefined;
    if (token && config.issuer)
      await fetch(new URL("oauth/revoke", config.issuer), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: config.clientId, token }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => undefined);
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
    if (secureAvailable()) {
      await ensureCache();
      await cachePurge(path);
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
  ipcMain.handle("suite:save-file", async (event, filename, content) => {
    sender(event);
    if (
      typeof filename !== "string" ||
      !/^orders-[0-9a-f-]+\.csv$/i.test(filename) ||
      typeof content !== "string" ||
      content.length > 20 * 1024 * 1024
    )
      throw Error("Invalid export");
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: filename,
      filters: [{ name: "CSV export", extensions: ["csv"] }],
    });
    if (!result.canceled && result.filePath)
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
    refreshToken = (await readSecure<{ refreshToken?: string }>("credentials"))
      ?.refreshToken;
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
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
    win.once("ready-to-show", () => win?.show());
    void win.loadURL("suite://app/index.html");
  };
  createWindow();
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
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
