import { useEffect, useRef } from "react";
import { halftoneGrid } from "./artwork/halftone-grid.mjs";
import sourceUrl from "./artwork/sign-in-source.png";

/** Render the supplied artwork at a fixed visual dot pitch, including on Retina displays. */
export function SignInArtwork() {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current!;
    const source = new Image();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let artwork: ReturnType<typeof halftoneGrid> | undefined;
    let animationFrame = 0;
    let previousTime = 0;
    let elapsed = 0;
    let lastPaint = 0;
    let visible = false;
    const animate = (time: number) => {
      if (previousTime) elapsed += time - previousTime;
      previousTime = time;
      // Thirty frames per second is sufficient for this slow ambient motion.
      if (elapsed - lastPaint >= 1000 / 30) {
        artwork?.render(elapsed / 1000);
        lastPaint = elapsed;
      }
      animationFrame = requestAnimationFrame(animate);
    };
    const syncMotion = () => {
      cancelAnimationFrame(animationFrame);
      previousTime = 0;
      if (reducedMotion.matches) {
        artwork?.render();
        elapsed = lastPaint = 0;
      } else if (artwork && visible && !document.hidden && !disposed) {
        animationFrame = requestAnimationFrame(animate);
      }
    };
    const draw = () => {
      const { width, height } = element.getBoundingClientRect();
      if (
        disposed ||
        !source.complete ||
        !source.naturalWidth ||
        width < 1 ||
        height < 1
      )
        return;
      // Bound the working surface on very large displays without changing the composition.
      const resolution = Math.min(1, 1600 / Math.max(width, height));
      const input = document.createElement("canvas");
      input.width = Math.ceil(width * resolution);
      input.height = Math.ceil(height * resolution);
      const context = input.getContext("2d");
      if (!context) return;
      const fit = Math.max(
        input.width / source.naturalWidth,
        input.height / source.naturalHeight,
      );
      context.drawImage(
        source,
        (input.width - source.naturalWidth * fit) / 2,
        (input.height - source.naturalHeight * fit) / 2,
        source.naturalWidth * fit,
        source.naturalHeight * fit,
      );
      try {
        artwork = halftoneGrid(input, {
          pitch: Math.max(2, 12 * resolution),
          supersample: Math.min(2, window.devicePixelRatio || 1),
        });
        element.replaceChildren(artwork.composite);
        element.dataset.ready = "true";
        syncMotion();
      } catch {
        // Decorative artwork must never prevent account access.
        element.dataset.ready = "false";
      }
    };
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(draw, 100);
    });
    observer.observe(element);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncMotion();
    });
    visibilityObserver.observe(element);
    reducedMotion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncMotion);
    source.onload = draw;
    source.src = sourceUrl;
    return () => {
      disposed = true;
      clearTimeout(timer);
      source.onload = null;
      observer.disconnect();
      visibilityObserver.disconnect();
      cancelAnimationFrame(animationFrame);
      reducedMotion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
    };
  }, []);
  return <div ref={frame} className="login-artwork" aria-hidden="true" />;
}
