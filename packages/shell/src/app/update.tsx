import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  Tooltip,
} from "@suite/ui-web";
import { ArrowDownToLine, ArrowRight } from "@suite/ui-web/icons";

/** Keep an existing session intact until the user chooses to load a new asset version. */
export function AppUpdate({
  placement = "sidebar",
}: {
  placement?: "sidebar" | "signin";
}) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  const requested = useRef(false);
  useEffect(() => {
    if (window.suiteDesktop || !("serviceWorker" in navigator)) return;
    let active = true;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const ready = () => {
      if (active)
        setWaiting(
          registration?.active && navigator.serviceWorker.controller
            ? registration.waiting
            : null,
        );
    };
    const found = () => {
      installing?.removeEventListener("statechange", ready);
      installing = registration?.installing ?? null;
      installing?.addEventListener("statechange", ready);
    };
    const changed = () => {
      if (requested.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    void navigator.serviceWorker.getRegistration().then((value) => {
      if (!active || !value) return;
      registration = value;
      ready();
      found();
      registration.addEventListener("updatefound", found);
      void registration.update().catch(() => undefined);
    });
    return () => {
      active = false;
      registration?.removeEventListener("updatefound", found);
      installing?.removeEventListener("statechange", ready);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
    };
  }, []);
  if (!waiting) return null;
  const label = updating ? "Updating…" : "Update ready";
  return (
    <>
      <span className="sr-only" role="status">
        {label}
      </span>
      <DropdownMenu>
        <Tooltip
          content={label}
          side={placement === "sidebar" ? "right" : "top"}
        >
          <DropdownMenuTrigger
            className={`app-update-trigger ${placement === "sidebar" ? "rail-update" : "signin-update"}`}
            aria-label={label}
          >
            <ArrowDownToLine size={18} />
            <span className={placement === "sidebar" ? "nav-label" : undefined}>
              {label}
            </span>
            {placement === "sidebar" && (
              <i className="update-indicator" aria-hidden="true" />
            )}
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent
          className="update-menu"
          side={placement === "sidebar" ? "right" : "top"}
          align="end"
          sideOffset={12}
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel>Update ready</DropdownMenuLabel>
            <p>Save your changes, then reload to use the latest version.</p>
            <DropdownMenuItem
              disabled={updating}
              closeOnClick={false}
              onClick={() => {
                requested.current = true;
                setUpdating(true);
                waiting.postMessage({ type: "SKIP_WAITING" });
              }}
            >
              {updating ? "Updating…" : "Reload to update"}
              <ArrowRight size={15} />
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
