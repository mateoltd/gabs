import { useEffect, useRef } from "react";
import { ApiError, type SuiteClient } from "@suite/client/api";
import type { Bootstrap } from "@suite/contracts";
import {
  canUse,
  type Platform,
  type Scope,
  type Snapshot,
} from "@suite/client";
import type { ModuleCatalog } from "@suite/module-sdk/catalog";

/** An older reply may arrive after a newer notification or explicit refresh. */
export function newerPolicy(
  current: Bootstrap | undefined,
  candidate: Bootstrap,
): Bootstrap {
  if (!current) return candidate;
  const previous = BigInt(current.policyRevision ?? "0");
  const next = BigInt(candidate.policyRevision ?? "0");
  if (
    next < previous ||
    (next === previous && candidate.authorizedAt < current.authorizedAt)
  )
    return current;
  return candidate;
}

/** Loading an old disk snapshot must not undo a policy already received online. */
export function snapshotWithPolicy(
  snapshot: Snapshot,
  catalog: ModuleCatalog,
  policy?: Bootstrap,
): Snapshot {
  if (!policy) return snapshot;
  const bootstrap = newerPolicy(snapshot.bootstrap, policy);
  return {
    ...snapshot,
    bootstrap,
    expiresAt:
      new Date(bootstrap.authorizedAt).getTime() +
      bootstrap.offlineHours * 3600000,
    products: !bootstrap.offlineHours
      ? []
      : canUse(bootstrap, "inventory", "inventory.read", catalog)
        ? snapshot.products
        : canUse(bootstrap, "inventory", "inventory.availability.read", catalog)
          ? snapshot.products.map(({ onHand, reserved, ...product }) => product)
          : [],
    orders:
      bootstrap.offlineHours &&
      canUse(bootstrap, "orders", "orders.read", catalog)
        ? snapshot.orders
        : [],
  };
}

/** Serialize disk writes with received policy, including writes already waiting for storage. */
export async function persistSnapshotPolicy(
  platform: Platform,
  scope: Scope,
  catalog: ModuleCatalog,
  currentPolicy: () => Bootstrap | undefined,
  value?: Snapshot | null,
): Promise<Snapshot | null | undefined> {
  return navigator.locks.request(
    `suite-snapshot:${scope.userId}:${scope.workspaceId}`,
    async () => {
      if (value === null) {
        await platform.save(scope, "snapshot", null);
        return null;
      }
      const stored = await platform.load<Snapshot>(scope, "snapshot");
      const candidate = value ?? stored;
      // A policy refresh never opts a device into local storage.
      if (!candidate) return undefined;
      const policy = currentPolicy();
      for (const bootstrap of [candidate.bootstrap, stored?.bootstrap, policy])
        if (bootstrap && bootstrap.workspace.id !== scope.workspaceId)
          throw Error("Offline policy belongs to a different workspace.");
      // The persisted policy also protects against an older write from another tab.
      const result = snapshotWithPolicy(
        snapshotWithPolicy(candidate, catalog, stored?.bootstrap),
        catalog,
        policy,
      );
      await platform.save(scope, "snapshot", result);
      return result;
    },
  );
}

/** Long polling uses the same bounded, credential-protected transport on both clients. */
export function usePolicyDelivery(
  client: SuiteClient,
  workspaceId: string,
  userId: string,
  online: boolean,
  receive: (bootstrap: Bootstrap, changed: boolean) => Promise<void>,
  failure: (error: unknown) => void,
) {
  const latest = useRef({ receive, failure });
  latest.current = { receive, failure };
  useEffect(() => {
    if (!online) return;
    const controller = new AbortController();
    let revision: string | undefined;
    let delay = 1000;
    const pause = () =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, delay);
        controller.signal.addEventListener("abort", done, { once: true });
        if (controller.signal.aborted) done();
      });
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const result = await client.request(
            {
              operation: "workspacePolicy",
              params: { workspaceId },
              query: revision ? { since: revision } : {},
            },
            { signal: controller.signal },
          );
          if (controller.signal.aborted) break;
          await latest.current.receive(
            result.bootstrap,
            revision !== result.revision,
          );
          revision = result.revision;
          delay = 1000;
        } catch (error) {
          if (controller.signal.aborted) break;
          if (error instanceof ApiError && [401, 403].includes(error.status)) {
            latest.current.failure(error);
            delay = 30000;
          }
          await pause();
          delay = Math.min(delay * 2, 30000);
        }
      }
    })();
    return () => controller.abort();
  }, [client, workspaceId, userId, online]);
}
