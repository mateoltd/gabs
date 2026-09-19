const key = "suite-profile-signin";
export interface ProfileSignIn {
  token: string;
  profileId?: string;
}
export function profileSignIn(): ProfileSignIn | undefined {
  const raw = sessionStorage.getItem(key);
  if (!raw) return;
  try {
    const value = JSON.parse(raw) as ProfileSignIn;
    if (
      typeof value.token === "string" &&
      (value.profileId === undefined || typeof value.profileId === "string")
    )
      return value;
  } catch {
    /* An invalid local hint grants no account access. */
  }
  sessionStorage.removeItem(key);
}
export function beginProfileSignIn(profileId?: string) {
  const attempt = {
    token: crypto.randomUUID(),
    ...(profileId ? { profileId } : {}),
  };
  sessionStorage.setItem(key, JSON.stringify(attempt));
  return attempt;
}
export function finishProfileSignIn(attempt: ProfileSignIn) {
  if (profileSignIn()?.token === attempt.token) sessionStorage.removeItem(key);
}
/** Reject a provider account mismatch before the host changes its active surface. */
export async function validateProfileSignIn(
  client: SuiteClient,
  identity: { user: { id: string }; csrfToken?: string },
  attempt = profileSignIn(),
) {
  if (!attempt?.profileId || identity.user.id === attempt.profileId) return;
  const record = await rememberSignOut(identity.user.id, identity.csrfToken);
  await terminateSession(client, identity.user.id, !window.suiteDesktop);
  if (window.suiteDesktop) await window.suiteDesktop.logout();
  acknowledgeSignOut(record);
  finishProfileSignIn(attempt);
  throw new ApiError(
    401,
    "PROFILE_MISMATCH",
    "The provider signed in a different account. Choose your saved profile and try again.",
  );
}

const chooserKey = "suite-profile-chooser";
export function requestProfileChooser() {
  sessionStorage.setItem(chooserKey, "open");
}
export function takeProfileChooser() {
  const open = sessionStorage.getItem(chooserKey) === "open";
  sessionStorage.removeItem(chooserKey);
  return open;
}
import { ApiError, type SuiteClient } from "@suite/client/api";
import {
  rememberSignOut,
  terminateSession,
  acknowledgeSignOut,
} from "./signout";
