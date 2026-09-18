import { useEffect, useRef, useState } from "react";
import { canUse, type FeatureProps } from "@suite/client";
import { ApiError } from "@suite/client/api";
import { browserCapabilityLeases } from "@suite/client/browser";
import type { ModuleDefinition } from "@suite/module-sdk";

export function deviceLeaseAccess(current: FeatureProps) {
  return {
    policyRevision: current.bootstrap.policyRevision ?? "0",
    offlineEnabled:
      current.offlineEnabled && current.bootstrap.offlineHours > 0,
    expiresAt:
      Date.parse(current.bootstrap.authorizedAt) +
      current.bootstrap.offlineHours * 3600000,
  };
}

/** Prepare declared read-only device grants when this verified custom view is open online. */
export function useDeviceLeases(
  props: FeatureProps,
  module: ModuleDefinition,
  viewPermission: string,
  enabled: boolean,
) {
  const latest = useRef(props);
  latest.current = props;
  const [state, setState] = useState<{
    expiresAt?: number;
    unavailable?: boolean;
    revision?: string;
    capabilities?: string[];
  }>({});
  const [, refreshTime] = useState(0);
  const keys = useRef(new Map<string, string>());
  const declarations = Object.entries(module.capabilities ?? {}).filter(
    ([, declaration]) => declaration.offline === "lease",
  );
  useEffect(() => {
    if (!enabled || !declarations.length) return;
    if (!props.offlineEnabled) {
      if (window.suiteDesktop)
        void window.suiteDesktop
          .prepareModuleOffline(props.scope, module.id, module.version, false)
          .catch(() => {});
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const live = (permission = viewPermission) => {
      const current = latest.current;
      if (
        !active ||
        (props.online ? !current.online || !navigator.onLine : current.online)
      )
        throw Error("Reconnect to prepare offline device access.");
      if (
        !canUse(
          current.bootstrap,
          module.id,
          permission,
          current.moduleCatalog,
        ) ||
        !canUse(
          current.bootstrap,
          module.id,
          viewPermission,
          current.moduleCatalog,
        )
      )
        throw Error("Your current permissions do not allow this host action.");
      return deviceLeaseAccess(current);
    };
    const renew = async () => {
      let next = 30000;
      try {
        live();
        const current = latest.current;
        if (window.suiteDesktop) {
          const result = await window.suiteDesktop.prepareModuleOffline(
            current.scope,
            module.id,
            module.version,
            true,
          );
          live();
          setState(
            result.expiresAt
              ? {
                  expiresAt: result.expiresAt,
                  revision: live().policyRevision,
                  capabilities: result.capabilities,
                }
              : { unavailable: true },
          );
          if (result.expiresAt && props.online)
            next = Math.max(
              1000,
              Math.min(300000, (result.expiresAt - Date.now()) / 2),
            );
          return;
        }
        if (!props.online) {
          let expiresAt = Infinity;
          for (const [alias, declaration] of declarations) {
            if (
              !canUse(
                current.bootstrap,
                module.id,
                declaration.permission,
                current.moduleCatalog,
              )
            )
              continue;
            expiresAt = Math.min(
              expiresAt,
              await browserCapabilityLeases.inspect(
                current.scope,
                module,
                alias,
                () => live(declaration.permission),
              ),
            );
          }
          if (Number.isFinite(expiresAt))
            setState({ expiresAt, revision: live().policyRevision });
          else setState({ unavailable: true });
          return;
        }
        const authority = await browserCapabilityLeases.observeAuthority(
          current.scope,
          () =>
            current.client.request(
              { operation: "capabilityLeaseKey" },
              { signal: controller.signal },
            ),
          () => {
            live();
          },
        );
        let expiresAt = Infinity;
        for (const [alias, declaration] of declarations) {
          if (
            !canUse(
              latest.current.bootstrap,
              module.id,
              declaration.permission,
              current.moduleCatalog,
            )
          )
            continue;
          const idempotencyKey = keys.current.get(alias) ?? crypto.randomUUID();
          keys.current.set(alias, idempotencyKey);
          let expiry = 0;
          await browserCapabilityLeases.refresh(
            current.scope,
            module,
            alias,
            () => live(declaration.permission),
            async () => {
              const lease = await current.client.request(
                {
                  operation: "moduleCapabilityLease",
                  params: {
                    workspaceId: current.scope.workspaceId,
                    moduleId: module.id,
                  },
                  moduleVersion: module.version,
                  body: { capability: alias },
                  idempotencyKey,
                },
                { signal: controller.signal },
              );
              expiry = Math.min(lease.payload.expiresAt, live().expiresAt);
              return { authority, lease };
            },
          );
          keys.current.delete(alias);
          expiresAt = Math.min(expiresAt, expiry);
        }
        live();
        if (Number.isFinite(expiresAt)) {
          setState({ expiresAt, revision: live().policyRevision });
          next = Math.max(
            1000,
            expiresAt -
              Date.now() -
              Math.min(300000, (expiresAt - Date.now()) / 2),
          );
        } else setState({ unavailable: true });
      } catch (error) {
        if (
          !window.suiteDesktop &&
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          await browserCapabilityLeases
            .invalidate(latest.current.scope)
            .catch(() => {});
          keys.current.clear();
          if (error.code === "CAPABILITY_LEASE_RENEWAL_REQUIRED") next = 1000;
        }
        if (active) setState({ unavailable: true });
      } finally {
        if (active) timer = setTimeout(() => void renew(), next);
      }
    };
    setState({});
    void renew();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    enabled,
    module,
    props.online,
    props.offlineEnabled,
    props.bootstrap.policyRevision,
    viewPermission,
  ]);
  useEffect(() => {
    if (!state.expiresAt) return;
    const timer = setTimeout(
      () => refreshTime((value) => value + 1),
      Math.max(0, state.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [state.expiresAt]);
  let message: string | undefined;
  if (enabled && props.offlineEnabled && declarations.length) {
    if (
      state.expiresAt &&
      state.expiresAt > Date.now() &&
      state.revision === (props.bootstrap.policyRevision ?? "0")
    ) {
      const actions = [
        ...new Set(
          declarations
            .filter(
              ([alias, declaration]) =>
                (!state.capabilities || state.capabilities.includes(alias)) &&
                canUse(
                  props.bootstrap,
                  module.id,
                  declaration.permission,
                  props.moduleCatalog,
                ),
            )
            .map(([, declaration]) =>
              declaration.kind === "files.export"
                ? "file exports"
                : "notifications",
            ),
        ),
      ].join(" and ");
      message = `Offline access for ${actions} until ${new Date(state.expiresAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}.`;
    } else if (!props.online)
      message = "Offline device access is unavailable. Reconnect to renew it.";
    else
      message = state.unavailable
        ? "Offline device access could not be prepared. Retrying shortly."
        : "Preparing offline device access…";
  }
  return { message, unavailable: () => setState({ unavailable: true }) };
}
