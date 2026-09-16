import { useLayoutEffect, useRef, type ComponentProps } from "react";

/** Production CSS can normalize milliseconds to seconds. */
export function motionDuration(name: string, fallback: number) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const amount = parseFloat(value);
  return Number.isFinite(amount)
    ? amount * (value.endsWith("ms") ? 1 : 1000)
    : fallback;
}

/** Keep controls and focus mounted while a new result set settles into place. */
export function ResultsMotion({
  motionKey,
  pending = false,
  className = "",
  children,
  ...props
}: ComponentProps<"div"> & { motionKey: string; pending?: boolean }) {
  const region = useRef<HTMLDivElement>(null);
  const settledKey = useRef<string | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const firstRender = !mounted.current;
    mounted.current = true;
    if (pending || settledKey.current === motionKey) return;
    settledKey.current = motionKey;
    const node = region.current;
    if (!node || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // The browser already fades this entire page snapshot. Capture opaque rows.
    if (firstRender && node.closest('[data-entrance="snapshot"]')) return;
    const style = getComputedStyle(node);
    const animation = node.animate(
      [
        { opacity: 0, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: motionDuration("--duration-fast", 250),
        easing: style.getPropertyValue("--ease-smooth-out").trim(),
      },
    );
    return () => animation.cancel();
  }, [motionKey, pending]);
  return (
    <div
      {...props}
      ref={region}
      className={`results-motion ${className}`}
      aria-busy={pending}
    >
      <div className="results-motion-content">{children}</div>
      <span className="sr-only" role="status">
        {pending ? "Updating results" : ""}
      </span>
    </div>
  );
}

/** A stable first-load silhouette, sized to the content it will become. */
export function ContentSkeleton({
  label = "Loading results",
  overview = false,
}: {
  label?: string;
  overview?: boolean;
}) {
  return (
    <div
      className={`content-skeleton ${overview ? "overview-skeleton" : ""}`}
      role="status"
    >
      <span className="sr-only">{label}</span>
      {overview && (
        <div className="skeleton-metrics" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <i />
              <b />
              <i />
            </div>
          ))}
        </div>
      )}
      <div className="skeleton-table" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div className="skeleton-row" key={i}>
            <i />
            <i />
            <i />
            <i />
          </div>
        ))}
      </div>
    </div>
  );
}
