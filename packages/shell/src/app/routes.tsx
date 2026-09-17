import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ContentSkeleton } from "@suite/ui-web";
import { flushSync } from "react-dom";
import { Routes, useLocation } from "react-router";

/** Snapshot only page content. The shell stays live during navigation. */
export function MotionRoutes({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [displayed, setDisplayed] = useState(location);
  const current = useRef(displayed);
  const snapshotNavigation = useRef(false);
  const moveFocus = useRef(false);
  current.current = displayed;
  useLayoutEffect(() => {
    const main = document.getElementById("main-content");
    main?.scrollTo({ top: 0, behavior: "instant" });
    if (moveFocus.current) main?.focus({ preventScroll: true });
    moveFocus.current = false;
  }, [displayed.pathname]);
  useEffect(() => {
    if (current.current === location) return;
    const changingPage = current.current.pathname !== location.pathname;
    if (changingPage)
      moveFocus.current = !!document
        .getElementById("main-content")
        ?.contains(document.activeElement);
    if (
      !changingPage ||
      current.current.pathname === "/" ||
      !document.startViewTransition ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplayed(location);
      return;
    }
    snapshotNavigation.current = true;
    let cancelled = false;
    const transition = document.startViewTransition(() => {
      if (cancelled) return;
      flushSync(() => setDisplayed(location));
    });
    // A newer navigation or backgrounded tab may legitimately skip snapshots.
    void transition.ready.catch(() => {});
    void transition.finished.catch(() => {});
    return () => {
      cancelled = true;
      transition.skipTransition();
    };
  }, [location]);
  // Search/filter changes keep their existing component and input focus.
  const visible =
    location.pathname === displayed.pathname ? location : displayed;
  return (
    <div
      className="route-stage"
      data-entrance={snapshotNavigation.current ? "snapshot" : "initial"}
      key={visible.pathname}
    >
      <Suspense fallback={<ContentSkeleton label="Loading your tools" />}>
        <Routes location={visible}>{children}</Routes>
      </Suspense>
    </div>
  );
}
