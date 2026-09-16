import { installModule, deviceId, verifyArtifact } from "./module-installation";
import {
  changeModuleStorage,
  readModuleStorage,
} from "@suite/platform/module-storage";
import { LocalWorkspace } from "./local-workspace";
import {
  Organization,
  Appearance,
  Billing,
  LocalNetwork,
} from "./platform-admin";
import { hydrateModule } from "@suite/module-sdk";
import { moduleDefinitions, registerModule } from "@suite/module-catalog";
import { ModuleGate } from "./module-gate";
import { ModuleSurface } from "./custom-module-view";
import { Input } from "@suite/ui-web";
import {
  Component,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  BrowserRouter,
  HashRouter,
  NavLink,
  Navigate,
  Route,
  useLocation,
} from "react-router";
import {
  navigationIcons,
  Bell,
  LogOut,
  WifiOff,
  Menu,
  X,
  Plus,
} from "@suite/ui-web/icons";
import { SuiteClient, ApiError } from "@suite/api-client";
import { getPlatform } from "@suite/platform/browser";
import {
  canReadSnapshot,
  canUse,
  type Snapshot,
  type RememberedIdentity,
  type FeatureProps,
} from "@suite/platform";
import { type Bootstrap } from "@suite/contracts";
import {
  Button,
  FeedbackProvider,
  Tooltip,
  Empty,
  ErrorMessage,
  Loading,
  Modal,
  Field,
  ActionMenu,
} from "@suite/ui-web";
import { People, Modules, Audit, Notifications, Settings } from "./admin";
import { Overview } from "./overview";
import { WorkspaceSearch } from "./search";
import { WorkspaceBreadcrumb, WorkspaceSwitcher } from "./workspace-breadcrumb";
import { AppUpdate } from "./update";
import { Login } from "./login";
import { MotionRoutes } from "./routes";
import { brandIconUrl } from "./brand";
const Orders = lazy(() => import("@suite/orders/web"));
const Inventory = lazy(() => import("@suite/inventory/web"));
const platform = getPlatform();
const client = new SuiteClient(
  window.suiteDesktop
    ? (request) => window.suiteDesktop!.execute(request)
    : undefined,
);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, e) =>
        !(e instanceof ApiError && e.status < 500) && count < 1,
      staleTime: 15000,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
function useConnectivity() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    let active = true,
      probing = false;
    const probe = async () => {
      if (!navigator.onLine) {
        if (active) setOnline(false);
        return;
      }
      if (probing) return;
      probing = true;
      try {
        await client.request({ operation: "connection" });
        if (active) setOnline(true);
      } catch {
        if (active) setOnline(false);
      } finally {
        probing = false;
      }
    };
    const up = () => {
        void probe();
      },
      down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    void probe();
    const timer = setInterval(up, 15000);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
class FeatureBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed)
      this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? (
      <Empty
        title="This view could not be loaded"
        description="Your saved work is safe. Reload this view to try again."
        action={
          <Button onClick={() => this.setState({ failed: false })}>
            Try again
          </Button>
        }
      />
    ) : (
      this.props.children
    );
  }
}

function Workspace({
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
  const scope = useMemo(
    () => ({ userId: user.id, workspaceId }),
    [user.id, workspaceId],
  );
  const qc = useQueryClient();
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
  const boot = useQuery({
    queryKey: [user.id, workspaceId, "bootstrap"],
    queryFn: () =>
      client.request({ operation: "bootstrap", params: { workspaceId } }),
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
          setCached(value);
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
  const bootstrapData = online
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
      (canUse(boot.data, "inventory", "inventory.read") ||
        canUse(boot.data, "inventory", "inventory.availability.read")),
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
      online && !!boot.data && canUse(boot.data, "orders", "orders.read"),
  });
  const handleError = useCallback(
    (e: unknown) => {
      setError(e);
      if (e instanceof ApiError && e.code === "MEMBERSHIP_REVOKED") {
        // Revoke access immediately, retaining provisional work for authorized recovery.
        setCached(undefined);
        setOfflineEnabled(false);
        void Promise.all([
          platform.save(scope, "snapshot", null),
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
  useEffect(() => {
    if (boot.error) handleError(boot.error);
  }, [boot.error, handleError]);
  useEffect(() => {
    if (!online || !boot.data || !cacheLoaded) return;
    if (!boot.data.offlineHours) {
      if (cached) {
        void platform
          .save(scope, "snapshot", {
            ...cached,
            expiresAt: 0,
            bootstrap: boot.data,
            products: [],
            orders: [],
          })
          .then(() => {
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
      products: canUse(boot.data, "inventory", "inventory.read")
        ? (products.data?.items ?? cached?.products ?? [])
        : canUse(boot.data, "inventory", "inventory.availability.read")
          ? (products.data?.items ?? cached?.products ?? []).map(
              ({ onHand, reserved, ...p }) => p,
            )
          : [],
      orders: canUse(boot.data, "orders", "orders.read")
        ? (orders.data?.items ?? cached?.orders ?? [])
        : [],
      cachedAt: Date.now(),
      expiresAt:
        new Date(boot.data.authorizedAt).getTime() +
        boot.data.offlineHours * 3600000,
    };
    void platform
      .save(scope, "snapshot", value)
      .then(() => {
        setCached(value);
        return platform.rememberIdentity({
          userId: user.id,
          name: user.name,
          workspaceId,
        });
      })
      .catch(setError);
  }, [
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
        registerModule(hydrateModule(module));
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
        registerModule(
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
    ...moduleDefinitions
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
          (canUse(bootstrapData, m.id, m.navigation!.permission) ||
            (m.id === "inventory" &&
              canUse(bootstrapData, m.id, "inventory.availability.read"))),
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
        online: online && !!boot.data && !boot.isError,
        platform,
        snapshot: canReadSnapshot(cached, now) ? cached : undefined,
        offlineEnabled,
        onError: handleError,
      }
    : undefined;
  useEffect(() => {
    if (!features?.online || !catalog.data) return;
    let active = true;
    const current = features,
      state = catalog.data;
    void (async () => {
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
        if (device?.state === "removed") continue;
        const stored = await readModuleStorage(current.platform, current.scope);
        if (
          stored.installed[definition.id]?.version === definition.version &&
          device?.state === "installed"
        )
          continue;
        try {
          await installModule(
            current,
            state,
            definition.id,
            false,
            () => active,
          );
          if (active)
            await qc.invalidateQueries({
              queryKey: [
                scope.userId,
                scope.workspaceId,
                "runtime-installation",
                definition.id,
              ],
            });
        } catch (error) {
          if (active) current.onError(error);
        }
      }
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
          ) : (
            <FeatureBoundary key={workspaceId} resetKey={title}>
              <MotionRoutes>
                <Route path="/" element={<Navigate to="/overview" replace />} />
                <Route
                  path="/organization"
                  element={onlineOnly(<Organization {...features} />)}
                />
                <Route path="/overview" element={<Overview {...features} />} />
                {moduleDefinitions
                  .filter((m) => !m.legacyView && m.navigation)
                  .map((m) => (
                    <Route
                      key={m.id}
                      path={m.navigation!.path}
                      element={
                        <ModuleGate {...features} moduleId={m.id}>
                          {(installation) => (
                            <ModuleSurface {...features} {...installation} />
                          )}
                        </ModuleGate>
                      }
                    />
                  ))}
                <Route
                  path="/orders"
                  element={
                    <ModuleGate {...features} moduleId="orders">
                      <Orders {...features} />
                    </ModuleGate>
                  }
                />
                <Route
                  path="/inventory"
                  element={
                    <ModuleGate {...features} moduleId="inventory">
                      <Inventory {...features} />
                    </ModuleGate>
                  }
                />
                <Route
                  path="/modules"
                  element={onlineOnly(<Modules {...features} />)}
                />
                <Route
                  path="/people"
                  element={
                    bootstrapData?.permissions.includes("members.manage") ? (
                      onlineOnly(<People {...features} />)
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
                      onlineOnly(<Audit {...features} />)
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
                  element={onlineOnly(<Notifications {...features} />)}
                />
                <Route
                  path="/settings"
                  element={onlineOnly(
                    <>
                      <Settings
                        {...features}
                        toggleOffline={toggleOffline}
                        theme={theme}
                        setTheme={setTheme}
                      >
                        <Appearance {...features} />
                        <Billing {...features} />
                        <LocalNetwork {...features} />
                      </Settings>
                    </>,
                  )}
                />
                <Route
                  path="*"
                  element={
                    (
                      online ? catalog.isSuccess : installedCatalog.isSuccess
                    ) ? (
                      <Navigate to="/overview" replace />
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
        </main>
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
function Session() {
  const [localMode, setLocalMode] = useState(false);
  useEffect(() => {
    const enter = () => setLocalMode(true);
    window.addEventListener("suite-local-mode", enter);
    return () => window.removeEventListener("suite-local-mode", enter);
  }, []);
  const online = useConnectivity(),
    qc = useQueryClient();
  const [identity, setIdentity] = useState<RememberedIdentity>(),
    [identityLoaded, setIdentityLoaded] = useState(false),
    [workspaceId, setWorkspaceId] = useState(
      localStorage.getItem("suite-workspace") ?? "",
    );
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const result = await client.request({ operation: "me" });
      if (localStorage.getItem("suite-logout-pending")) {
        await client.request({ operation: "logout" });
        localStorage.removeItem("suite-logout-pending");
        throw new ApiError(401, "SIGNED_OUT", "Sign in to continue.");
      }
      return result;
    },
    enabled: online,
    retry: false,
  });
  useEffect(() => {
    platform
      .identity()
      .then(setIdentity)
      .catch(() => setIdentity(undefined))
      .finally(() => setIdentityLoaded(true));
  }, []);
  const refresh = useCallback(() => me.refetch(), [me.refetch]);
  const workspaces =
    me.data?.workspaces ??
    (identity
      ? [
          {
            id: identity.workspaceId,
            name: "Offline workspace",
            kind: "company",
            currency: "EUR",
          },
        ]
      : []);
  const selected = workspaces.some((w) => w.id === workspaceId)
    ? workspaceId
    : (workspaces.find((w) => w.kind === "personal")?.id ?? workspaces[0]?.id);
  const restoreWorkspaceFocus = useRef(false);
  useEffect(() => {
    // Changing workspaces remounts the scoped UI, including the menu trigger.
    if (restoreWorkspaceFocus.current) {
      document
        .querySelector<HTMLButtonElement>(
          matchMedia("(max-width: 700px)").matches
            ? ".mobile-menu"
            : ".rail-workspace-switch",
        )
        ?.focus();
      restoreWorkspaceFocus.current = false;
    }
  }, [selected]);
  const select = (id: string) => {
    restoreWorkspaceFocus.current = id !== selected;
    setWorkspaceId(id);
    localStorage.setItem("suite-workspace", id);
  };
  async function logout() {
    const userId = me.data?.user.id ?? identity?.userId;
    localStorage.setItem("suite-logout-pending", "1");
    // Clear local data even when the network session cannot be reached.
    if (userId) await platform.purgeUser(userId);
    await platform.rememberIdentity(undefined);
    setIdentity(undefined);
    localStorage.removeItem("suite-workspace");
    if (window.suiteDesktop) {
      await window.suiteDesktop.logout();
      localStorage.removeItem("suite-logout-pending");
    } else if (online) {
      try {
        await client.request({ operation: "logout" });
        localStorage.removeItem("suite-logout-pending");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401)
          localStorage.removeItem("suite-logout-pending");
      }
    }
    qc.clear();
    setWorkspaceId("");
    if (!online) window.location.reload();
    else await me.refetch();
  }
  if (localMode) return <LocalWorkspace onExit={() => setLocalMode(false)} />;
  if (online && me.isLoading && !identity)
    return <Loading label="Opening your workspace" />;
  if (online && me.error instanceof ApiError && me.error.status === 426)
    return (
      <main className="offline-start">
        <Empty
          title="Update Common to continue"
          description="Install the current desktop release. Your local drafts remain on this device and can be reopened after updating."
        />
      </main>
    );
  if (online && !me.data && !me.isLoading) return <Login />;
  if (!online && !identityLoaded) return <Loading />;
  const user =
    me.data?.user ??
    (identity
      ? { id: identity.userId, name: identity.name, email: "" }
      : undefined);
  if (!user || !selected)
    return online ? (
      <Login />
    ) : (
      <main className="offline-start">
        <Empty
          title="Connect to open your workspace"
          description="This device does not have an authorized offline copy."
          action={
            <Button onClick={() => setLocalMode(true)}>
              Open local profiles
            </Button>
          }
        />
      </main>
    );
  return (
    <Workspace
      key={user.id + selected}
      user={user}
      workspaceId={selected}
      workspaces={workspaces}
      onWorkspace={select}
      online={online && !!me.data}
      onLogout={logout}
      onRefreshIdentity={refresh}
      invitations={me.data?.invitations ?? []}
    />
  );
}
export function App() {
  const Router = window.suiteDesktop ? HashRouter : BrowserRouter;
  return (
    <QueryClientProvider client={queryClient}>
      <link rel="icon" type="image/png" href={brandIconUrl} />
      <FeedbackProvider>
        <Router>
          <Session />
        </Router>
      </FeedbackProvider>
    </QueryClientProvider>
  );
}
