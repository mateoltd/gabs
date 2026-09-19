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

const chooserKey = "suite-profile-chooser";
export function requestProfileChooser() {
  sessionStorage.setItem(chooserKey, "open");
}
export function takeProfileChooser() {
  const open = sessionStorage.getItem(chooserKey) === "open";
  sessionStorage.removeItem(chooserKey);
  return open;
}
