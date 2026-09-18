import {
  Suspense,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ContentSkeleton } from "@suite/ui-web";
import { flushSync } from "react-dom";
import {
  useNavigate,
  useHref,
  Routes,
  useLocation,
  type NavigateProps,
} from "react-router";

const ActiveLocation = createContext<string | undefined>(undefined);

/** A retained page may finish loading during a newer navigation. It cannot redirect it. */
export function RouteRedirect({ to, replace, state, relative }: NavigateProps) {
  const active = useContext(ActiveLocation);
  const displayed = useLocation();
  const navigate = useNavigate();
  const href = useHref(displayed);
  useEffect(() => {
    // Browser history may have advanced before this router render committed.
    // Recheck it at execution time so startup cannot replace a newer user action.
    const actual = new URL(window.location.href);
    if (window.suiteDesktop)
      actual.hash = "/" + actual.hash.slice(1).replace(/^\//, "");
    const rendered = new URL(href, actual);
    if (active === displayed.key && actual.href === rendered.href)
      void navigate(to, { replace, state, relative });
  }, [active, displayed.key, href, navigate, to, replace, state, relative]);
  return null;
}

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
  // The startup redirect must unmount immediately when the user chooses a page.
  // Keeping the old root route alive for one effect can redirect that newer click.
  const visible =
    displayed.pathname === "/" || location.pathname === displayed.pathname
      ? location
      : displayed;
  return (
    <div
      className="route-stage"
      data-entrance={snapshotNavigation.current ? "snapshot" : "initial"}
      key={visible.pathname}
    >
      <Suspense fallback={<ContentSkeleton label="Loading your tools" />}>
        <ActiveLocation.Provider value={location.key}>
          <Routes location={visible}>{children}</Routes>
        </ActiveLocation.Provider>
      </Suspense>
    </div>
  );
}
