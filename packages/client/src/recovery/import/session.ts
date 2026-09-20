import {
  ProfileRecoveryClockSchema,
  ProfileRecoverySchema,
  type ProfileRecovery,
} from "@suite/contracts";
import { assertSchema } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import type { Scope } from "../../index";
import type { SuiteClient } from "../../api";

const signInAgain = () =>
  Error("Sign in again to import saved work into this account.");
const clockUnavailable = () =>
  Error("The recovery clock is unavailable. Sign in again.");

interface LocalClockStart {
  wall: number;
  monotonic: number;
}

function startLocalClock(): LocalClockStart {
  const start = { wall: Date.now(), monotonic: performance.now() };
  if (!Number.isFinite(start.wall) || !Number.isFinite(start.monotonic))
    throw clockUnavailable();
  return start;
}

function session(
  proof: ProfileRecovery,
  scope: Scope,
  observedAt: string,
  startedAt: LocalClockStart,
) {
  const serverObservedAt = Date.parse(observedAt);
  if (!Number.isFinite(serverObservedAt)) throw clockUnavailable();
  try {
    assertSchema(ProfileRecoverySchema, proof);
  } catch {
    throw signInAgain();
  }
  const expected = canonical(proof);
  let elapsedHighWater = 0;
  const now = () => {
    const wallElapsed = Date.now() - startedAt.wall;
    const monotonicElapsed = performance.now() - startedAt.monotonic;
    if (
      !Number.isFinite(wallElapsed) ||
      !Number.isFinite(monotonicElapsed) ||
      monotonicElapsed < 0
    )
      throw clockUnavailable();
    elapsedHighWater = Math.max(
      elapsedHighWater,
      0,
      wallElapsed,
      monotonicElapsed,
    );
    const current = serverObservedAt + elapsedHighWater;
    if (!Number.isFinite(elapsedHighWater) || !Number.isFinite(current))
      throw clockUnavailable();
    return current;
  };
  const check = (candidate: ProfileRecovery = proof) => {
    try {
      assertSchema(ProfileRecoverySchema, candidate);
    } catch {
      throw signInAgain();
    }
    const issued = Date.parse(candidate.authenticatedAt);
    const expires = Date.parse(candidate.expiresAt);
    const current = now();
    if (
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      candidate.userId !== scope.userId ||
      issued > current ||
      expires <= current ||
      expires <= issued ||
      expires - issued > 300_000 ||
      canonical(candidate) !== expected
    )
      throw signInAgain();
  };
  check();
  return { check };
}

/** Bind import authority to one server clock sample and one exact authenticated session. */
export async function createImportSession(
  client: SuiteClient,
  scope: Scope,
  signal: AbortSignal,
  guard: () => void,
) {
  guard();
  const proof = await client.request(
    { operation: "profileRecovery" },
    { signal },
  );
  guard();
  const startedAt = startLocalClock();
  const clock = await client.request(
    { operation: "profileRecoveryClock" },
    { signal },
  );
  guard();
  try {
    assertSchema(ProfileRecoveryClockSchema, clock);
  } catch {
    throw clockUnavailable();
  }
  return session(proof, scope, clock.now, startedAt);
}
