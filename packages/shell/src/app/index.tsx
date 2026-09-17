import { type RememberedIdentity } from "@suite/client";
import { ApiError } from "@suite/client/api";
import { Button, Empty, FeedbackProvider, Loading } from "@suite/ui-web";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, HashRouter } from "react-router";
import { Login } from "../features/identity/login";
import { LocalWorkspace } from "../features/modules/local/workspace";
import { brandIconUrl } from "./brand";
import { ShellCompositionProvider, type ShellComposition } from "./composition";
import { client, platform, queryClient, useConnectivity } from "./runtime";
import { Workspace } from "./workspace";

export type { ShellComposition } from "./composition";

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
  if (localMode) {
    const personal = me.data?.workspaces.find(
      (workspace) => workspace.kind === "personal",
    );
    return (
      <LocalWorkspace
        onExit={() => setLocalMode(false)}
        registry={
          personal
            ? {
                client,
                userId: me.data!.user.id,
                workspaceId: personal.id,
                online: online && !!me.data,
              }
            : undefined
        }
      />
    );
  }
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
export function App({ composition }: { composition: ShellComposition }) {
  const Router = window.suiteDesktop ? HashRouter : BrowserRouter;
  return (
    <QueryClientProvider client={queryClient}>
      <link rel="icon" type="image/png" href={brandIconUrl} />
      <ShellCompositionProvider value={composition}>
        <FeedbackProvider>
          <Router>
            <Session />
          </Router>
        </FeedbackProvider>
      </ShellCompositionProvider>
    </QueryClientProvider>
  );
}
