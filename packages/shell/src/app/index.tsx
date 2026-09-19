import { rememberOnlineProfile } from "@suite/client/online-profile-store";
import {
  profileSignIn,
  finishProfileSignIn,
} from "../features/identity/profile-signin";
import { type RememberedIdentity } from "@suite/client";
import {
  invalidateBrowserAccount,
  subscribeBrowserAccount,
} from "@suite/client/browser";
import { ApiError } from "@suite/client/api";
import {
  Button,
  Empty,
  FeedbackProvider,
  Loading,
  useToast,
} from "@suite/ui-web";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, HashRouter } from "react-router";
import { Login } from "../features/identity/login";
import {
  rememberSignOut,
  terminateSession,
  acknowledgeSignOut,
  hasSignedOut,
  reconcileSignOut,
  rememberAuthenticatedSession,
} from "../features/identity/signout";
import { LocalWorkspace } from "../features/modules/local/workspace";
import { brandIconUrl } from "./brand";
import { ShellCompositionProvider, type ShellComposition } from "./composition";
import { client, platform, queryClient, useConnectivity } from "./runtime";
import { Workspace } from "./workspace";

export type { ShellComposition } from "./composition";

function Session() {
  const toast = useToast();
  const [localMode, setLocalMode] = useState(false);
  const [endingSession, setEndingSession] = useState(false);
  useEffect(() => {
    const enter = () => setLocalMode(true);
    window.addEventListener("suite-local-mode", enter);
    return () => window.removeEventListener("suite-local-mode", enter);
  }, []);
  const online = useConnectivity(),
    qc = useQueryClient();
  const [invalidUser, setInvalidUser] = useState<string>();
  const [identity, setIdentity] = useState<RememberedIdentity>(),
    [identityLoaded, setIdentityLoaded] = useState(false),
    [workspaceId, setWorkspaceId] = useState(
      localStorage.getItem("suite-workspace") ?? "",
    );
  useEffect(
    () =>
      client.onIdentityInvalidated(async ({ userId, reason, remote }) => {
        setInvalidUser(userId);
        setIdentity((current) =>
          current?.userId === userId ? undefined : current,
        );
        if (!window.suiteDesktop && !remote)
          await invalidateBrowserAccount(userId, reason === "signed-out");
        await navigator.locks.request("suite-remembered-identity", async () => {
          const remembered = await platform.identity();
          if (remembered?.userId === userId)
            await platform.rememberIdentity(undefined);
        });
        await qc.cancelQueries({ queryKey: [userId] });
        qc.removeQueries({ queryKey: [userId] });
        if (reason === "unauthenticated")
          void qc.invalidateQueries({ queryKey: ["me"] });
      }),
    [qc],
  );
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async ({ signal }) => {
      const attempt = profileSignIn();
      const result = await client
        .request({ operation: "me" }, { signal })
        .catch(async (error: unknown) => {
          // After a restart the transport has no in-memory actor yet. A confirmed
          // denial still expires the saved account's leases before offline fallback.
          if (
            error instanceof ApiError &&
            error.status === 401 &&
            error.code !== "PROFILE_CHANGED" &&
            !signal.aborted
          ) {
            const remembered = await navigator.locks.request(
              "suite-remembered-identity",
              () => platform.identity(),
            );
            if (remembered) await client.invalidateIdentity(remembered.userId);
          }
          throw error;
        });
      signal.throwIfAborted();
      if (profileSignIn()?.token !== attempt?.token)
        throw new DOMException(
          "A newer sign-in superseded this request.",
          "AbortError",
        );
      if (attempt?.profileId && result.user.id !== attempt.profileId) {
        const record = await rememberSignOut(result.user.id, result.csrfToken);
        await terminateSession(client, result.user.id, !window.suiteDesktop);
        if (window.suiteDesktop) await window.suiteDesktop.logout();
        acknowledgeSignOut(record);
        finishProfileSignIn(attempt);
        throw new ApiError(
          401,
          "PROFILE_MISMATCH",
          "The provider signed in a different account. Choose your saved profile and try again.",
        );
      }
      await reconcileSignOut(client, result);
      await rememberAuthenticatedSession(result, signal);
      await navigator.locks.request("suite-remembered-identity", async () => {
        const remembered = await platform.identity();
        signal.throwIfAborted();
        if (!client.isCurrentUser(result.user.id))
          throw new DOMException(
            "A newer profile superseded this identity.",
            "AbortError",
          );
        if (remembered && remembered.userId !== result.user.id) {
          if (!window.suiteDesktop)
            await invalidateBrowserAccount(remembered.userId);
          await platform.rememberIdentity(undefined);
          setIdentity(undefined);
        }
      });
      signal.throwIfAborted();
      if (!client.isCurrentUser(result.user.id))
        throw new DOMException(
          "A newer profile superseded this identity.",
          "AbortError",
        );
      try {
        await rememberOnlineProfile(
          result.user,
          !!attempt,
          () =>
            !signal.aborted &&
            client.isCurrentUser(result.user.id) &&
            profileSignIn()?.token === attempt?.token,
        );
      } catch {
        toast.add({
          title: "Profile was not saved",
          description:
            "You are signed in. Device storage could not save this account for later selection.",
        });
      }
      signal.throwIfAborted();
      if (!client.isCurrentUser(result.user.id))
        throw new DOMException("The active profile changed.", "AbortError");
      if (attempt) finishProfileSignIn(attempt);
      return result;
    },
    enabled: online,
    retry: false,
  });
  useEffect(() => {
    navigator.locks
      .request("suite-remembered-identity", async () => {
        const remembered = await platform.identity();
        setIdentity(
          remembered && !hasSignedOut(remembered.userId)
            ? remembered
            : undefined,
        );
      })
      .catch(() => setIdentity(undefined))
      .finally(() => setIdentityLoaded(true));
  }, []);
  const refresh = useCallback(() => me.refetch(), [me.refetch]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "suite-logout-pending" && event.newValue) {
        const userId = me.data?.user.id ?? identity?.userId;
        if (userId && hasSignedOut(userId))
          void client.invalidateIdentity(userId, true, "signed-out");
      }
      if (event.key === "suite-session-change")
        void client.invalidateIdentity(me.data?.user.id ?? identity?.userId);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [me.data?.user.id, identity?.userId]);
  useEffect(() => {
    const userId = me.data?.user.id ?? identity?.userId;
    if (window.suiteDesktop || !userId) return;
    return subscribeBrowserAccount(userId, (signedOut) => {
      void client.invalidateIdentity(
        userId,
        true,
        signedOut ? "signed-out" : "unauthenticated",
      );
    });
  }, [me.data?.user.id, identity?.userId]);
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
    if (!userId) return;
    setEndingSession(true);
    try {
      const record = await rememberSignOut(userId, me.data?.csrfToken);
      await terminateSession(client, userId, online && !window.suiteDesktop);
      if (window.suiteDesktop) await window.suiteDesktop.logout();
      if (online || window.suiteDesktop) acknowledgeSignOut(record);
    } finally {
      localStorage.removeItem("suite-workspace");
      qc.clear();
      setWorkspaceId("");
      setEndingSession(false);
      if (!online) window.location.reload();
      else void me.refetch();
    }
  }
  if (endingSession)
    return (
      <Loading label="Signing out. Your saved work stays on this device." />
    );
  if (localMode) {
    const personal = me.data?.workspaces.find(
      (workspace) => workspace.kind === "personal",
    );
    return (
      <LocalWorkspace
        onExit={() => setLocalMode(false)}
        registry={
          personal && me.data && client.isCurrentUser(me.data.user.id)
            ? {
                client: client.forUser(me.data.user.id),
                userId: me.data.user.id,
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
  if (
    invalidUser &&
    invalidUser === me.data?.user.id &&
    !client.isCurrentUser(invalidUser)
  )
    return online ? (
      <Login
        failure={
          me.error instanceof ApiError && me.error.code === "PROFILE_MISMATCH"
            ? me.error
            : undefined
        }
      />
    ) : (
      <main className="offline-start">
        <Empty
          title="Profile access is locked"
          description="Connect and sign in again to recover your saved work."
        />
      </main>
    );
  if (online && !me.data && !me.isLoading)
    return (
      <Login
        failure={
          me.error instanceof ApiError && me.error.code === "PROFILE_MISMATCH"
            ? me.error
            : undefined
        }
      />
    );
  if (!online && !identityLoaded) return <Loading />;
  const user =
    me.data?.user ??
    (identity
      ? { id: identity.userId, name: identity.name, email: "" }
      : undefined);
  if (!user || !selected)
    return online ? (
      <Login
        failure={
          me.error instanceof ApiError && me.error.code === "PROFILE_MISMATCH"
            ? me.error
            : undefined
        }
      />
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
