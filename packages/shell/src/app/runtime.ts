import { useEffect, useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { SuiteClient, ApiError } from "@suite/client/api";
import { getPlatform } from "@suite/client/browser";
import {
  getBrowserProfileLock,
  browserProfileRecovery,
  completeBrowserProfileRecovery,
  cancelBrowserProfileRecovery,
} from "@suite/client/browser-profile-lock";
import { hasSignedOut, reconcileSignOut } from "../features/identity/signout";
import { validateProfileSignIn } from "../features/identity/profile-signin";

export const platform = getPlatform();
export const browserProfileLock = window.suiteDesktop
  ? undefined
  : getBrowserProfileLock();
export const profileLock = window.suiteDesktop ?? {
  profileLockStatus: () => browserProfileLock!.profileLockStatus(),
  onProfileLock: browserProfileLock!.onProfileLock.bind(browserProfileLock),
  unlockProfile: browserProfileLock!.unlockProfile.bind(browserProfileLock),
  configureProfileLock:
    browserProfileLock!.configureProfileLock.bind(browserProfileLock),
  removeProfileLock:
    browserProfileLock!.removeProfileLock.bind(browserProfileLock),
  lockProfile: () => {
    cancelBrowserProfileRecovery();
    return browserProfileLock!.lockProfile();
  },
};
export const profileLockReady = browserProfileLock
  ? platform.identity().then(async (identity) => {
      const recovery = browserProfileRecovery();
      const account =
        recovery?.challenge.account ??
        (identity && !hasSignedOut(identity.userId)
          ? identity.userId
          : undefined);
      await browserProfileLock.activate(account);
      if (recovery) {
        try {
          await finishBrowserProfileRecovery();
        } catch (error) {
          return error;
        }
      }
    })
  : Promise.resolve();
void profileLockReady.catch(() => {});
let recoveryAccount: string | undefined;
export async function finishBrowserProfileRecovery() {
  await completeBrowserProfileRecovery(async (account) => {
    recoveryAccount = account;
    try {
      await client.request({ operation: "me" });
    } finally {
      recoveryAccount = undefined;
    }
  });
}
export const client = new SuiteClient(
  window.suiteDesktop
    ? (request) => window.suiteDesktop!.execute(request)
    : undefined,
  browserProfileLock
    ? {
        async before(request, userId) {
          if (request.operation === "connection") return;
          if (
            recoveryAccount &&
            request.operation === "me" &&
            !request.expectedUserId
          )
            return browserProfileLock!.fence();
          await profileLockReady;
          if (request.operation === "me" && !request.expectedUserId)
            return browserProfileLock!.fence();
          const account = userId ?? browserProfileLock!.currentAccount();
          if (!account)
            throw new ApiError(
              423,
              "PROFILE_LOCKED",
              "Open your profile before continuing.",
            );
          return browserProfileLock!.access(account);
        },
        async identity(identity) {
          if (recoveryAccount) {
            if (identity.user.id !== recoveryAccount)
              throw new ApiError(
                401,
                "PROFILE_CHANGED",
                "The sign-in account changed during recovery.",
              );
            return;
          }
          await profileLockReady;
          await validateProfileSignIn(client, identity);
          if (hasSignedOut(identity.user.id))
            await reconcileSignOut(client, identity);
          await browserProfileLock!.activate(identity.user.id);
          await (
            await browserProfileLock!.access(identity.user.id)
          )();
        },
      }
    : undefined,
);
if (browserProfileLock)
  client.onIdentityInvalidated(async ({ userId, reason }) => {
    if (reason === "changed" || browserProfileLock.currentAccount() !== userId)
      return;
    cancelBrowserProfileRecovery();
    try {
      await browserProfileLock.lockProfile();
    } catch {
      /* Sign-out must still revoke this tab's access when storage fails. */
    }
    await browserProfileLock.activate();
  });
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500) && count < 1,
      staleTime: 15000,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

export function useConnectivity() {
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
