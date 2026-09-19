import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { BrandIcon } from "../../app/brand";
import "./background-privacy.css";

/** A screen privacy cover, not a credential lock or an authorization boundary. */
export function BackgroundPrivacy() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const originalInert = body.inert;
    let blurred = false;
    let covered = false;
    let previousFocus: HTMLElement | undefined;
    const update = () => {
      const next = document.visibilityState === "hidden" || blurred;
      if (next === covered) return;
      covered = next;
      if (next) {
        previousFocus =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : undefined;
        // Apply synchronously, including portals outside the React root. Keep
        // the live component tree and its unsaved input mounted underneath.
        root.setAttribute("data-background-privacy", "");
        body.inert = true;
      } else {
        root.removeAttribute("data-background-privacy");
        body.inert = originalInert;
        if (
          !originalInert &&
          previousFocus?.isConnected &&
          !previousFocus.closest("[inert], [hidden]")
        )
          previousFocus.focus({ preventScroll: true });
        previousFocus = undefined;
      }
    };
    const blur = () => {
      blurred = true;
      update();
    };
    const focus = () => {
      blurred = false;
      update();
    };
    const visibility = () => {
      if (document.visibilityState === "visible" && document.hasFocus())
        blurred = false;
      update();
    };
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    update();
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
      root.removeAttribute("data-background-privacy");
      body.inert = originalInert;
    };
  }, []);
  return createPortal(
    <div className="background-privacy" data-background-cover="">
      <BrandIcon size={32} />
      <p>Content hidden while Common is in the background.</p>
    </div>,
    document.body,
  );
}
