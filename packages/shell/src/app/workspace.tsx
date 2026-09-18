import {
  canReadSnapshot,
  canUse,
  type FeatureProps,
  type Snapshot,
} from "@suite/client";
import { ApiError } from "@suite/client/api";
import { browserCapabilityLeases } from "@suite/client/browser";
import {
  changeModuleStorage,
  readModuleStorage,
} from "@suite/client/module-storage";
import { hydrateModule } from "@suite/module-sdk";
import {
  ActionMenu,
  Button,
  Empty,
  ErrorMessage,
  Field,
  Input,
  Loading,
  Modal,
  PreservedSurface,
  Tooltip,
} from "@suite/ui-web";
import {
  Bell,
  LogOut,
  Menu,
  Plus,
  WifiOff,
  X,
  navigationIcons,
} from "@suite/ui-web/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NavLink, Route, useLocation } from "react-router";
import {
  Audit,
  Modules,
  Notifications,
  People,
  Settings,
} from "../features/administration/admin";
import {
  Appearance,
  Billing,
  LocalNetwork,
  Organization,
} from "../features/administration/platform-admin";
import {
  newerPolicy,
  snapshotWithPolicy,
  usePolicyDelivery,
} from "../features/administration/policy-delivery";
import {
  deviceId,
  flushInstallationReports,
  installModule,
  uninstallModule,
  verifiedInstalledModule,
  verifyArtifact,
} from "../features/modules/installation";
import { ModuleSurface } from "../features/modules/views/custom-view";
import { ModuleGate } from "../features/modules/views/gate";
import { Overview } from "../features/workspaces/overview";
import { WorkspaceSearch } from "../features/workspaces/search";
import {
  WorkspaceBreadcrumb,
  WorkspaceSwitcher,
} from "../navigation/workspace-breadcrumb";
import { useShellComposition } from "./composition";
import { FeatureBoundary } from "./feature-boundary";
import { MotionRoutes, RouteRedirect } from "./routes";
import { client, platform } from "./runtime";
import { AppUpdate } from "./update";
import {
  useLocalNetwork,
  LocalNetworkStatus,
} from "../features/administration/local-network-state";

function LegacyModuleRoute({
  features,
  moduleId,
}: {
  features: FeatureProps;
  moduleId: string;
}) {
  const { moduleViews } = useShellComposition();
  const View = moduleViews[moduleId];
  return (
    <ModuleGate {...features} moduleId={moduleId}>
      {({ pkg }) =>
        View ? (
          <View
            {...features}
            definition={hydrateModule(
              pkg.artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
            )}
          />
        ) : (
          <Empty
            title="Module view unavailable"
            description="This host does not include the installed module view."
          />
        )
      }
    </ModuleGate>
  );
}

export function Workspace({
  user,
  workspaceId,
  workspaces,
  onWorkspace,
  online,
  onLogout,
  onRefreshIdentity,
  invitations,
}: {
  user: { id: string; name: string; email: string };
  workspaceId: string;
  workspaces: { id: string; name: string; kind: string; currency: string }[];
  onWorkspace: (id: string) => void;
  online: boolean;
  onLogout: () => Promise<void>;
  onRefreshIdentity: () => Promise<unknown>;
  invitations: {
    id: string;
    workspaceId: string;
    workspaceName: string;
    expiresAt: string;
  }[];
}) {
  const { catalog: moduleCatalog } = useShellComposition();
  const scope = useMemo(
    () => ({ userId: user.id, workspaceId }),
    [user.id, workspaceId],
  );
  const qc = useQueryClient();
  const saveSnapshot = useCallback(
    (value: Snapshot | null) =>
      navigator.locks.request(
        `suite-snapshot:${scope.userId}:${scope.workspaceId}`,
        () => platform.save(scope, "snapshot", value),
      ),
    [scope],
  );

  const [policyDenied, setPolicyDenied] = useState(false);
  const [validatedOnline, setValidatedOnline] = useState(false);
  useEffect(() => {
    if (!online) setValidatedOnline(false);
  }, [online]);
  const [cached, setCached] = useState<Snapshot>(),
    [cacheLoaded, setCacheLoaded] = useState(false),
    [offlineEnabled, setOfflineEnabled] = useState(false),
    [error, setError] = useState<unknown>(),
    [menuOpen, setMenuOpen] = useState(false),
    [theme, setTheme] = useState(localStorage.getItem("suite-theme") ?? "dark");
  const [newWorkspace, setNewWorkspace] = useState(false),
    [companyName, setCompanyName] = useState(""),
    [companyId, setCompanyId] = useState(crypto.randomUUID()),
    [creating, setCreating] = useState(false);
  const nativeSecurity = useQuery({
    queryKey: ["native-security"],
    queryFn: () => window.suiteDesktop!.securityStatus(),
    enabled: !!window.suiteDesktop,
  });
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 700px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 700px)");
    const update = () => {
      setNarrow(media.matches);
      if (!media.matches) setMenuOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!menuOpen || !narrow) return;
    const elements = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled), select:not(:disabled)",
        ) ?? [],
      );
    elements()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      // A nested menu owns Escape and focus until it closes.
      if (sidebarRef.current?.querySelector("[aria-haspopup][data-popup-open]"))
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
      }
      if (event.key !== "Tab") return;
      const items = elements(),
        first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("keydown", keyboard, true);
      menuRef.current?.focus();
    };
  }, [menuOpen, narrow]);
  const location = useLocation();
  const [, tickClock] = useState(0);
  const now = Date.now();
  useEffect(() => {
    const id = setInterval(() => tickClock((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("suite-theme", theme);
  }, [theme]);
  const latestPolicy = useRef<import("@suite/contracts").Bootstrap | undefined>(
    undefined,
  );
  const cachePolicyEpoch = useRef(0);
  const devicePolicy = useRef<string | undefined>(undefined);
  const acceptPolicy = async (
    candidate: import("@suite/contracts").Bootstrap,
  ) => {
    const next = newerPolicy(latestPolicy.current, candidate);
    if (next !== latestPolicy.current) cachePolicyEpoch.current++;
    latestPolicy.current = next;
    const revision = next.policyRevision ?? "0";
    if (!window.suiteDesktop && devicePolicy.current !== revision) {
      devicePolicy.current = revision;
      try {
        await browserCapabilityLeases.observePolicy(
          scope,
          revision,
          next.offlineHours > 0,
        );
      } catch (error) {
        if (devicePolicy.current === revision) devicePolicy.current = undefined;
        setError(error);
      }
    }
    return latestPolicy.current;
  };
  const boot = useQuery({
    queryKey: [user.id, workspaceId, "bootstrap"],
    queryFn: async ({ signal }) => {
      const result = await client.request(
        { operation: "bootstrap", params: { workspaceId } },
        { signal },
      );
      signal.throwIfAborted();
      if (!signal.aborted) {
        setValidatedOnline(true);
        setPolicyDenied(false);
      }
      return acceptPolicy(result);
    },
    enabled: online,
    retry: false,
    refetchInterval: online ? 30000 : false,
  });
  useEffect(() => {
    let active = true;
    platform
      .load<Snapshot>(scope, "snapshot")
      .then((value) => {
        if (active) {
          setCached(
            value
              ? snapshotWithPolicy(value, moduleCatalog, latestPolicy.current)
              : value,
          );
          setOfflineEnabled(!!value);
          setCacheLoaded(true);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e);
          setCacheLoaded(true);
        }
      });
    return () => {
      active = false;
      client.cancelWorkspace(workspaceId);
      void qc.cancelQueries({ queryKey: [user.id, workspaceId] });
    };
  }, [scope, qc, user.id, workspaceId]);
  const bootstrapData = policyDenied
    ? undefined
    : online
      ? (boot.data ??
        (boot.isPending && canReadSnapshot(cached, now)
          ? cached.bootstrap
          : undefined))
      : canReadSnapshot(cached, now)
        ? cached.bootstrap
        : undefined;
  useEffect(() => {
    document.documentElement.dataset.accent =
      bootstrapData?.workspace.accent ?? "forest";
    return () => {
      delete document.documentElement.dataset.accent;
    };
  }, [bootstrapData?.workspace.accent]);
  const products = useQuery({
    queryKey: [user.id, workspaceId, "products", "", undefined],
    queryFn: () =>
      client.request({
        operation: "products",
        params: { workspaceId },
        query: { search: "" },
      }),
    enabled:
      online &&
      !!boot.data &&
      (canUse(boot.data, "inventory", "inventory.read", moduleCatalog) ||
        canUse(
          boot.data,
          "inventory",
          "inventory.availability.read",
          moduleCatalog,
        )),
  });
  const orders = useQuery({
    queryKey: [user.id, workspaceId, "orders", "", undefined],
    queryFn: () =>
      client.request({
        operation: "orders",
        params: { workspaceId },
        query: { search: "" },
      }),
    enabled:
      online &&
      !!boot.data &&
      canUse(boot.data, "orders", "orders.read", moduleCatalog),
  });
  const handleError = useCallback(
    (e: unknown) => {
      setError(e);
      if (
        e instanceof ApiError &&
        (e.status === 401 || e.code === "MEMBERSHIP_REVOKED")
      )
        setPolicyDenied(true);
      if (
        e instanceof ApiError &&
        (e.code === "MEMBERSHIP_REVOKED" || e.status === 401)
      ) {
        cachePolicyEpoch.current++;
        // Revoke access immediately, retaining provisional work for authorized recovery.
        setCached(undefined);
        setOfflineEnabled(false);
        void Promise.all([
          window.suiteDesktop
            ? Promise.resolve()
            : browserCapabilityLeases.invalidate(scope),
          saveSnapshot(null),
          changeModuleStorage(platform, scope, (s) => {
            s.pages = {};
            s.referenceOptions = {};
          }),
        ])
          .then(() => onRefreshIdentity())
          .catch(setError);
        qc.removeQueries({ queryKey: [user.id, workspaceId] });
      }
      if (e instanceof ApiError && e.status === 401) void onRefreshIdentity();
    },
    [scope, qc, onRefreshIdentity, user.id, workspaceId],
  );
  usePolicyDelivery(
    client,
    workspaceId,
    user.id,
    online,
    async (policy, changed) => {
      await qc.cancelQueries({ queryKey: [user.id, workspaceId, "bootstrap"] });
      policy = await acceptPolicy(policy);
      setPolicyDenied(false);
      setValidatedOnline(true);
      qc.setQueryData([user.id, workspaceId, "bootstrap"], policy);
      // Apply revocation to the current offline lease before any asynchronous cache write.
      setCached((previous) =>
        previous
          ? snapshotWithPolicy(previous, moduleCatalog, policy)
          : previous,
      );
      if (changed) {
        // A slow installation must not delay listening for the next suspension.
        void Promise.all([
          qc.invalidateQueries({
            queryKey: [user.id, workspaceId, "platform"],
          }),
          qc.invalidateQueries({
            queryKey: [user.id, workspaceId, "runtime-installation"],
          }),
        ]).catch(handleError);
      }
    },
    handleError,
  );
  useEffect(() => {
    if (boot.error) handleError(boot.error);
  }, [boot.error, handleError]);
  useEffect(() => {
    if (policyDenied || !online || !boot.data || !cacheLoaded) return;
    if (newerPolicy(latestPolicy.current, boot.data) !== boot.data) return;
    const epoch = cachePolicyEpoch.current;
    if (!boot.data.offlineHours) {
      if (cached) {
        void saveSnapshot({
          ...cached,
          expiresAt: 0,
          bootstrap: boot.data,
          products: [],
          orders: [],
        })
          .then(() => {
            if (epoch !== cachePolicyEpoch.current) return;
            setCached(undefined);
            setOfflineEnabled(false);
          })
          .catch(setError);
      }
      return;
    }
    if (!offlineEnabled) return;
    const value: Snapshot = {
      bootstrap: boot.data,
      products: canUse(boot.data, "inventory", "inventory.read", moduleCatalog)
        ? (products.data?.items ?? cached?.products ?? [])
        : canUse(
              boot.data,
              "inventory",
              "inventory.availability.read",
              moduleCatalog,
            )
          ? (products.data?.items ?? cached?.products ?? []).map(
              ({ onHand, reserved, ...p }) => p,
            )
          : [],
      orders: canUse(boot.data, "orders", "orders.read", moduleCatalog)
        ? (orders.data?.items ?? cached?.orders ?? [])
        : [],
      cachedAt: Date.now(),
      expiresAt:
        new Date(boot.data.authorizedAt).getTime() +
        boot.data.offlineHours * 3600000,
    };
    void saveSnapshot(value)
      .then(() => {
        if (epoch !== cachePolicyEpoch.current) return;
        setCached(value);
        return platform.rememberIdentity({
          userId: user.id,
          name: user.name,
          workspaceId,
        });
      })
      .catch(setError);
  }, [
    policyDenied,
    online,
    boot.data,
    products.data,
    orders.data,
    offlineEnabled,
    cacheLoaded,
    scope,
    user.id,
    user.name,
    workspaceId,
  ]);
  async function toggleOffline() {
    if (offlineEnabled) {
      const drafts = await platform.load<unknown[]>(scope, "drafts");
      const modules = await readModuleStorage(platform, scope);
      if (
        drafts?.length ||
        Object.keys(modules.drafts).length ||
        modules.journal.some((e) => e.state !== "accepted" && !e.supersededBy)
      )
        throw Error(
          "Resolve pending changes and saved drafts before disabling offline storage.",
        );
      await platform.purgeWorkspace(scope);
      setCached(undefined);
      setOfflineEnabled(false);
      return;
    }
    if (!boot.data?.offlineHours)
      throw Error("Offline storage is disabled by workspace policy.");
    setOfflineEnabled(true);
  }
  const catalog = useQuery({
    queryKey: [user.id, workspaceId, "platform"],
    enabled: online && !!bootstrapData,
    queryFn: async () => {
      const result = await client.request({
        operation: "platformState",
        params: { workspaceId },
      });
      for (const module of result.modules)
        moduleCatalog.register(hydrateModule(module));
      return result;
    },
    refetchInterval: 30000,
  });
  const installedCatalog = useQuery({
    queryKey: [user.id, workspaceId, "installed-catalog"],
    enabled: !online && !!bootstrapData,
    networkMode: "always",
    queryFn: async () => {
      const stored = await readModuleStorage(platform, {
        userId: user.id,
        workspaceId,
      });
      for (const installed of Object.values(stored.installed)) {
        if (!installed.signed || !installed.publicKey) continue;
        await verifyArtifact(installed.signed, installed.publicKey);
        moduleCatalog.register(
          hydrateModule(
            installed.signed
              .artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
          ),
        );
      }
      return true;
    },
  });
  const inbox = useQuery({
    queryKey: [user.id, workspaceId, "notifications"],
    queryFn: () =>
      client.request({ operation: "notifications", params: { workspaceId } }),
    enabled: online && !!bootstrapData,
    refetchInterval: 15000,
  });
  const notified = useRef<Set<string> | undefined>(undefined);
  useEffect(() => {
    if (!inbox.data) return;
    const previous = notified.current;
    notified.current = new Set(inbox.data.map((n) => n.id));
    if (previous)
      for (const n of inbox.data)
        if (!n.read && !previous.has(n.id))
          void platform.notify(n.title, n.message).catch(() => undefined);
  }, [inbox.data]);
  useEffect(() => {
    const appearance = catalog.data?.settings.find(
      (s) => s.key === "appearance",
    );
    const key = `suite-archetype:${workspaceId}`;
    const configured = appearance?.value.archetype;
    // Cache explicit workspace choices only. Previous defaults were cached as if chosen.
    if (catalog.data) {
      if (typeof configured === "string") localStorage.setItem(key, configured);
      else localStorage.removeItem(key);
    }
    document.documentElement.dataset.archetype = String(
      catalog.data
        ? (configured ?? "modern-dark")
        : (localStorage.getItem(key) ?? "modern-dark"),
    );
    return () => {
      delete document.documentElement.dataset.archetype;
    };
  }, [catalog.data, workspaceId]);
  useEffect(() => {
    const update = () =>
      setTheme(localStorage.getItem("suite-theme") ?? "system");
    window.addEventListener("suite-theme-change", update);
    return () => window.removeEventListener("suite-theme-change", update);
  }, []);
  const title = location.pathname.split("/")[1] || "overview";
  // Keep the established Orders/Inventory positions as new modules are discovered.
  const navigationOrder: Record<string, number> = { orders: 0, inventory: 1 };
  const navigation = [
    {
      path: "overview",
      label: "Overview",
      icon: navigationIcons.overview,
      show: true,
    },
    ...moduleCatalog.modules
      .filter((m) => m.navigation)
      .sort(
        (a, b) => (navigationOrder[a.id] ?? 2) - (navigationOrder[b.id] ?? 2),
      )
      .map((m) => ({
        path: m.navigation!.path.slice(1),
        label: m.name,
        icon:
          navigationIcons[m.id as keyof typeof navigationIcons] ??
          navigationIcons.modules,
        show:
          !!bootstrapData &&
          (canUse(
            bootstrapData,
            m.id,
            m.navigation!.permission,
            moduleCatalog,
          ) ||
            (m.id === "inventory" &&
              canUse(
                bootstrapData,
                m.id,
                "inventory.availability.read",
                moduleCatalog,
              ))),
      })),
    {
      path: "modules",
      label: "Modules",
      icon: navigationIcons.modules,
      show:
        !!bootstrapData?.permissions.includes("modules.manage") ||
        (!!catalog.data &&
          catalog.data.settings.find((s) => s.key === "store-policy")?.value
            .mode !== "blocked"),
    },
  ];
  const features: FeatureProps | undefined = bootstrapData
    ? {
        client,
        scope,
        bootstrap: bootstrapData,
        online: online && validatedOnline && !!boot.data && !boot.isError,
        platform,
        snapshot: canReadSnapshot(cached, now) ? cached : undefined,
        offlineEnabled,
        moduleCatalog,
        receivePolicy: async (candidate, signal) => {
          signal.throwIfAborted();
          const policy = await acceptPolicy(candidate);
          signal.throwIfAborted();
          await navigator.locks.request(
            `suite-snapshot:${scope.userId}:${scope.workspaceId}`,
            async () => {
              signal.throwIfAborted();
              const snapshot = await platform.load<Snapshot>(scope, "snapshot");
              signal.throwIfAborted();
              if (snapshot)
                await platform.save(
                  scope,
                  "snapshot",
                  snapshotWithPolicy(
                    snapshot,
                    moduleCatalog,
                    latestPolicy.current,
                  ),
                );
            },
          );
          signal.throwIfAborted();
          qc.setQueryData([user.id, workspaceId, "bootstrap"], policy);
          setCached((previous) =>
            previous
              ? snapshotWithPolicy(previous, moduleCatalog, policy)
              : previous,
          );
          return latestPolicy.current ?? policy;
        },
        onError: handleError,
      }
    : undefined;
  const localNetwork = useLocalNetwork(features);
  useEffect(() => {
    if (!features?.online || !catalog.data) return;
    let active = true;
    const current = features,
      state = catalog.data;
    const reportLifecycleError = async (id: string, error: unknown) => {
      if (!active) return;
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.code === "MEMBERSHIP_REVOKED")
      ) {
        current.onError(error);
        return;
      }
      try {
        await changeModuleStorage(current.platform, current.scope, (s) => {
          (s.lifecycleErrors ??= {})[id] =
            error instanceof Error
              ? error.message
              : "This module change could not finish.";
        });
      } catch {
        if (active) current.onError(error);
      }
    };
    void (async () => {
      let changed = false;
      await flushInstallationReports(current);
      const pending = await readModuleStorage(current.platform, current.scope);
      for (const [id, attempt] of Object.entries(pending.lifecycle ?? {})) {
        if (!active) break;
        if (attempt.action === "uninstall") {
          try {
            const removed = await uninstallModule(
              current,
              id,
              attempt.requestId,
              "background",
            );
            if (removed === false) continue;
            changed = true;
          } catch (error) {
            await reportLifecycleError(id, error);
          }
        }
      }
      for (const activation of current.bootstrap.modules) {
        if (!active) break;
        if (
          !activation.assigned ||
          !activation.entitled ||
          activation.state !== "enabled"
        )
          continue;
        const definition = state.modules.find(
          (m) => m.id === activation.moduleId,
        );
        if (!definition) continue;
        const device = state.installations.find(
          (i) => i.module_id === definition.id && i.device_id === deviceId(),
        );
        if (
          device?.state === "removed" ||
          pending.lifecycle?.[definition.id]?.action === "uninstall"
        )
          continue;
        const stored = await readModuleStorage(current.platform, current.scope);
        if (
          !stored.lifecycle?.[definition.id] &&
          device?.state === "installed" &&
          device.version === stored.installed[definition.id]?.version &&
          (stored.installed[definition.id]?.version === definition.version ||
            (await verifiedInstalledModule(
              current,
              stored,
              definition.id,
              state,
            ).catch(() => false)))
        )
          continue;
        try {
          const installed = await installModule(
            current,
            state,
            definition.id,
            false,
            () => active,
            "background",
          );
          if (!installed) continue;
          changed = true;
          if (active)
            await Promise.all([
              qc.invalidateQueries({
                queryKey: [
                  scope.userId,
                  scope.workspaceId,
                  "runtime-installation",
                  definition.id,
                ],
              }),
              qc.invalidateQueries({
                queryKey: [scope.userId, scope.workspaceId, "platform"],
              }),
              qc.invalidateQueries({
                queryKey: [
                  scope.userId,
                  scope.workspaceId,
                  "lifecycle-storage",
                ],
              }),
            ]);
        } catch (error) {
          await reportLifecycleError(definition.id, error);
        }
      }
      if (active && changed)
        await Promise.all([
          qc.invalidateQueries({
            queryKey: [scope.userId, scope.workspaceId, "platform"],
          }),
          qc.invalidateQueries({
            queryKey: [scope.userId, scope.workspaceId, "lifecycle-storage"],
          }),
        ]);
    })().catch((error) => {
      if (active) current.onError(error);
    });
    return () => {
      active = false;
    };
  }, [
    features?.online,
    bootstrapData,
    catalog.data,
    scope,
    client,
    platform,
    qc,
  ]);
  const retainedFeatures = useRef<FeatureProps | undefined>(undefined);
  if (features) retainedFeatures.current = features;
  const routeFeatures = features ?? retainedFeatures.current;
  const onlineOnly = (node: ReactNode) =>
    online ? (
      node
    ) : (
      <Empty
        title="Connect to manage this workspace"
        description="Administrative changes require current server authorization."
      />
    );
  return (
    <div className="application">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside
        id="workspace-navigation"
        ref={sidebarRef}
        role={narrow ? "dialog" : undefined}
        aria-modal={narrow && menuOpen ? true : undefined}
        aria-label={narrow ? "Workspace navigation" : undefined}
        className={`sidebar ${menuOpen ? "open" : ""}`}
      >
        <div className="wordmark">
          <WorkspaceSwitcher
            logoDataUrl={bootstrapData?.workspace.logoDataUrl}
            compact={narrow}
            workspaces={workspaces}
            workspaceId={workspaceId}
            onWorkspace={onWorkspace}
          />
          <Button
            variant="ghost"
            className="mobile-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </Button>
        </div>
        <nav aria-label="Main navigation">
          {navigation
            .filter((n) => n.show)
            .map((n) => (
              <Tooltip key={n.path} content={n.label} side="right">
                <NavLink
                  aria-label={n.label}
                  to={"/" + n.path}
                  onClick={() => setMenuOpen(false)}
                >
                  <n.icon size={18} weight="fill" aria-hidden="true" />
                  <span className="nav-label" aria-hidden="true">
                    {n.label}
                  </span>
                </NavLink>
              </Tooltip>
            ))}
        </nav>
        {bootstrapData &&
          (bootstrapData.permissions.includes("members.manage") ||
            bootstrapData.permissions.includes("audit.read") ||
            bootstrapData.permissions.includes("roles.manage")) && (
            <>
              <nav aria-label="Administration">
                {bootstrapData.permissions.includes("members.manage") && (
                  <Tooltip content="People & access" side="right">
                    <NavLink
                      to="/people"
                      aria-label="People & access"
                      onClick={() => setMenuOpen(false)}
                    >
                      <navigationIcons.people
                        size={18}
                        weight="fill"
                        aria-hidden="true"
                      />
                      <span className="nav-label" aria-hidden="true">
                        People & access
                      </span>
                    </NavLink>
                  </Tooltip>
                )}
                {bootstrapData.permissions.includes("roles.manage") && (
                  <Tooltip content="Organization" side="right">
                    <NavLink
                      to="/organization"
                      aria-label="Organization"
                      onClick={() => setMenuOpen(false)}
                    >
                      <navigationIcons.organization
                        size={18}
                        weight="fill"
                        aria-hidden="true"
                      />
                      <span className="nav-label" aria-hidden="true">
                        Organization
                      </span>
                    </NavLink>
                  </Tooltip>
                )}
                {bootstrapData.permissions.includes("audit.read") && (
                  <Tooltip content="Audit history" side="right">
                    <NavLink
                      to="/audit"
                      aria-label="Audit history"
                      onClick={() => setMenuOpen(false)}
                    >
                      <navigationIcons.audit
                        size={18}
                        weight="fill"
                        aria-hidden="true"
                      />
                      <span className="nav-label" aria-hidden="true">
                        Audit history
                      </span>
                    </NavLink>
                  </Tooltip>
                )}
              </nav>
            </>
          )}
        <div className="sidebar-bottom">
          <nav aria-label="Preferences">
            <AppUpdate />
            <Tooltip content="Settings" side="right">
              <NavLink
                to="/settings"
                aria-label="Settings"
                onClick={() => setMenuOpen(false)}
              >
                <navigationIcons.settings
                  size={18}
                  weight="fill"
                  aria-hidden="true"
                />
                <span className="nav-label" aria-hidden="true">
                  Settings
                </span>
              </NavLink>
            </Tooltip>
          </nav>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="nav-backdrop"
          tabIndex={-1}
          aria-label="Dismiss navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="app-main" inert={narrow && menuOpen}>
        <header className="topbar">
          <div className="actions">
            <Button
              variant="ghost"
              className="mobile-menu"
              ref={menuRef}
              aria-expanded={menuOpen}
              aria-controls="workspace-navigation"
              aria-label="Open navigation"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={19} />
            </Button>
            <WorkspaceBreadcrumb
              workspaceName={
                workspaces.find((workspace) => workspace.id === workspaceId)
                  ?.name ?? "Workspace"
              }
              page={
                title === "people"
                  ? "People & access"
                  : title.charAt(0).toUpperCase() + title.slice(1)
              }
            />
          </div>
          <div className="actions">
            {features && <WorkspaceSearch {...features} />}
            <NavLink
              to="/notifications"
              className="notification-link"
              aria-label="Notifications"
            >
              <Bell size={19} />
              {invitations.length +
                (inbox.data?.filter((n) => !n.read).length ?? 0) >
                0 && (
                <span className="notification-count">
                  {invitations.length +
                    (inbox.data?.filter((n) => !n.read).length ?? 0)}
                </span>
              )}
            </NavLink>
            <ActionMenu
              title={user.name}
              description={bootstrapData?.roleNames.join(", ") ?? "Member"}
              trigger={
                <button className="user-avatar" aria-label="Account menu">
                  {user.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </button>
              }
              items={[
                {
                  label: "New company",
                  icon: <Plus size={16} />,
                  disabled: !online,
                  onSelect: () => {
                    setNewWorkspace(true);
                    setCompanyName("");
                    setCompanyId(crypto.randomUUID());
                  },
                },
                {
                  label: "Local profiles",
                  onSelect: () =>
                    window.dispatchEvent(new Event("suite-local-mode")),
                },
                {
                  label: "Sign out",
                  icon: <LogOut size={16} />,
                  onSelect: () => {
                    void onLogout().catch(setError);
                  },
                },
              ]}
            />
          </div>
        </header>
        <main id="main-content" className="content" tabIndex={-1}>
          {nativeSecurity.data?.persistentStorage === false && (
            <div className="notice">
              Protected storage is unavailable. This desktop session will not
              remember credentials or save offline drafts.
            </div>
          )}
          {!online && (
            <div className="notice offline-notice">
              <WifiOff size={17} />
              <span>
                {canReadSnapshot(cached, now)
                  ? `Offline copy from ${new Date(cached.cachedAt).toLocaleString()}. Shared actions need a connection.`
                  : "Connect to revalidate this workspace. Unsent drafts remain stored."}
              </span>
            </div>
          )}
          {!!error && !(boot.error === error) && <ErrorMessage error={error} />}
          <div className="invitations-strip">
            {online &&
              invitations.map((i) => (
                <div className="notice invitation" key={i.id}>
                  <div>
                    <strong>{i.workspaceName} invited you to join.</strong>
                    <span>
                      Accept with your verified account to add this workspace.
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      try {
                        await client.request({
                          operation: "inviteAccept",
                          params: { id: i.id },
                          body: {},
                        });
                        await onRefreshIdentity();
                        onWorkspace(i.workspaceId);
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Accept
                  </Button>
                  <Button
                    onClick={async () => {
                      try {
                        await client.request({
                          operation: "inviteDecline",
                          params: { id: i.id },
                          body: {},
                        });
                        await onRefreshIdentity();
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Decline
                  </Button>
                </div>
              ))}
          </div>
          {!features ? (
            boot.error ? (
              <>
                <ErrorMessage error={boot.error} />
                <Button onClick={() => void boot.refetch()}>Retry</Button>
              </>
            ) : !online && cacheLoaded ? (
              <Empty
                title="Online authorization required"
                description="Reconnect to access this workspace. Unsent drafts will remain available after your access is revalidated."
              />
            ) : (
              <Loading />
            )
          ) : null}
          <PreservedSurface visible={!!features}>
            {routeFeatures && (
              <FeatureBoundary key={workspaceId} resetKey={title}>
                <MotionRoutes>
                  <Route
                    path="/"
                    element={<RouteRedirect to="/overview" replace />}
                  />
                  <Route
                    path="/organization"
                    element={onlineOnly(<Organization {...routeFeatures} />)}
                  />
                  <Route
                    path="/overview"
                    element={<Overview {...routeFeatures} />}
                  />
                  {moduleCatalog.modules
                    .filter((m) => !m.legacyView && m.navigation)
                    .map((m) => (
                      <Route
                        key={m.id}
                        path={m.navigation!.path}
                        element={
                          <ModuleGate {...routeFeatures} moduleId={m.id}>
                            {(installation) => (
                              <ModuleSurface
                                {...routeFeatures}
                                {...installation}
                              />
                            )}
                          </ModuleGate>
                        }
                      />
                    ))}
                  {moduleCatalog.modules
                    .filter((m) => m.legacyView && m.navigation)
                    .map((m) => (
                      <Route
                        key={m.id}
                        path={m.navigation!.path}
                        element={
                          <LegacyModuleRoute
                            features={routeFeatures}
                            moduleId={m.id}
                          />
                        }
                      />
                    ))}
                  <Route
                    path="/modules"
                    element={onlineOnly(<Modules {...routeFeatures} />)}
                  />
                  <Route
                    path="/people"
                    element={
                      bootstrapData?.permissions.includes("members.manage") ? (
                        onlineOnly(<People {...routeFeatures} />)
                      ) : (
                        <Empty
                          title="Administrator access required"
                          description="Your role does not allow people management."
                        />
                      )
                    }
                  />
                  <Route
                    path="/audit"
                    element={
                      bootstrapData?.permissions.includes("audit.read") ? (
                        onlineOnly(<Audit {...routeFeatures} />)
                      ) : (
                        <Empty
                          title="Audit access required"
                          description="Your role does not allow viewing the audit history."
                        />
                      )
                    }
                  />
                  <Route
                    path="/notifications"
                    element={onlineOnly(<Notifications {...routeFeatures} />)}
                  />
                  <Route
                    path="/settings"
                    element={
                      <Settings
                        {...routeFeatures}
                        toggleOffline={toggleOffline}
                        theme={theme}
                        setTheme={setTheme}
                      >
                        {routeFeatures.online && (
                          <>
                            <Appearance {...routeFeatures} />
                            <Billing {...routeFeatures} />
                          </>
                        )}
                        <LocalNetwork
                          {...routeFeatures}
                          network={localNetwork}
                        />
                      </Settings>
                    }
                  />
                  <Route
                    path="*"
                    element={
                      (
                        online ? catalog.isSuccess : installedCatalog.isSuccess
                      ) ? (
                        <RouteRedirect to="/overview" replace />
                      ) : (catalog.error ?? installedCatalog.error) ? (
                        <ErrorMessage
                          error={catalog.error ?? installedCatalog.error}
                        />
                      ) : (
                        <Loading />
                      )
                    }
                  />
                </MotionRoutes>
              </FeatureBoundary>
            )}
          </PreservedSurface>
        </main>
        <LocalNetworkStatus
          key={`${user.id}/${workspaceId}`}
          network={localNetwork}
        />
      </div>
      <Modal
        open={newWorkspace}
        onOpenChange={(o) => !creating && setNewWorkspace(o)}
        title="Create a company workspace"
        description="Your company gets its own data, roles, and module access. Company owners require verified email and MFA."
      >
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setCreating(true);
            try {
              const w = await client.request({
                operation: "workspaceCreate",
                body: { id: companyId, name: companyName, currency: "EUR" },
              });
              await onRefreshIdentity();
              onWorkspace(w.id);
              setNewWorkspace(false);
            } catch (e) {
              setError(e);
            } finally {
              setCreating(false);
            }
          }}
        >
          <Field label="Company name">
            <Input
              required
              autoFocus
              maxLength={100}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <p className="small">
            Pilot defaults: EUR, one inventory location, 10 seats.
          </p>
          <ErrorMessage error={error} />
          <Button type="submit" variant="primary" disabled={creating}>
            Create workspace
          </Button>
        </form>
      </Modal>
    </div>
  );
}
