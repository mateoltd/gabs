import { ApiError, type SuiteClient } from "@suite/client/api";

const key = "suite-logout-pending";
export const sessionTransitionLock = "suite-auth-session";
export function terminateSession(
  client: SuiteClient,
  userId: string,
  online: boolean,
) {
  return online
    ? navigator.locks.request(sessionTransitionLock, () =>
        client.signOut(userId, true),
      )
    : client.signOut(userId, false);
}
interface SignOutRecord {
  userId?: string;
  sessionFingerprint?: string;
  pending: boolean;
}
function read(): { raw: string; record: SignOutRecord } | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return;
  try {
    const record = JSON.parse(raw) as SignOutRecord;
    if (
      record &&
      typeof record.pending === "boolean" &&
      (record.userId === undefined || typeof record.userId === "string") &&
      (record.sessionFingerprint === undefined ||
        typeof record.sessionFingerprint === "string")
    )
      return { raw, record };
  } catch {
    /* Legacy pending sign-outs still require server termination. */
  }
  return { raw, record: { pending: true } };
}
async function fingerprint(token: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
const sessionKey = (userId: string) => `suite-session-fingerprint:${userId}`;
export async function rememberAuthenticatedSession(
  identity: {
    user: { id: string };
    csrfToken?: string;
  },
  signal?: AbortSignal,
) {
  if (identity.csrfToken) {
    const value = await fingerprint(identity.csrfToken);
    signal?.throwIfAborted();
    localStorage.setItem(sessionKey(identity.user.id), value);
  }
}
export async function rememberSignOut(userId: string, csrfToken?: string) {
  const sessionFingerprint = csrfToken
    ? await fingerprint(csrfToken)
    : (localStorage.getItem(sessionKey(userId)) ?? undefined);
  const raw = JSON.stringify({ userId, sessionFingerprint, pending: true });
  localStorage.setItem(key, raw);
  return raw;
}
export function acknowledgeSignOut(raw: string) {
  const saved = read();
  if (saved?.raw === raw)
    localStorage.setItem(
      key,
      JSON.stringify({ ...saved.record, pending: false }),
    );
}
export function hasSignedOut(userId: string) {
  const saved = read();
  return !!saved && (!saved.record.userId || saved.record.userId === userId);
}
/** A new server session has a new CSRF token, including after an OIDC redirect. */
export async function reconcileSignOut(
  client: SuiteClient,
  identity: { user: { id: string }; csrfToken?: string },
) {
  return navigator.locks.request(sessionTransitionLock, async () => {
    const saved = read();
    if (!saved) return;
    const { record, raw } = saved;
    if (
      (record.userId && record.userId !== identity.user.id) ||
      (identity.csrfToken &&
        ((record.sessionFingerprint &&
          record.sessionFingerprint !==
            (await fingerprint(identity.csrfToken))) ||
          (!record.sessionFingerprint && !record.pending)))
    ) {
      if (localStorage.getItem(key) === raw) localStorage.removeItem(key);
      return;
    }
    await client.signOut(identity.user.id, record.pending);
    acknowledgeSignOut(raw);
    throw new ApiError(
      401,
      "SIGNED_OUT",
      "Sign in again to recover your saved work.",
    );
  });
}
