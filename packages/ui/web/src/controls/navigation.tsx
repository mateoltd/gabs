import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Button } from "./actions";

export function Pagination({
  next,
  onNext,
  onPrevious,
  hasPrevious,
  pending = false,
}: {
  next: string | null | undefined;
  onNext: () => void;
  onPrevious: () => void;
  hasPrevious: boolean;
  pending?: boolean;
}) {
  return (
    <div className="pagination">
      <Button disabled={!hasPrevious || pending} onClick={onPrevious}>
        Previous
      </Button>
      <Button disabled={!next || pending} onClick={onNext}>
        Next page
      </Button>
    </div>
  );
}

/** Segmented filters with a measured sliding indicator and roving keyboard focus. */
export function SegmentedControl({
  panelId,
  label,
  value,
  options,
  onChange,
}: {
  panelId: string;
  label: string;
  value: string;
  options: { value: string; label: ReactNode }[];
  onChange: (value: string) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const initial = useRef(true);
  const move = (animate: boolean) => {
    const selected = bar.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (!pill.current || !selected) return;
    const prev = pill.current.style.transition;
    if (!animate) pill.current.style.transition = "none";
    pill.current.style.transform = `translateX(${selected.offsetLeft}px)`;
    pill.current.style.width = `${selected.offsetWidth}px`;
    if (!animate) {
      void pill.current.offsetWidth;
      pill.current.style.transition = prev;
    }
  };
  useLayoutEffect(() => {
    move(!initial.current);
    initial.current = false;
  }, [value, options]);
  useEffect(() => {
    const observer = new ResizeObserver(() => move(false));
    if (bar.current) observer.observe(bar.current);
    void document.fonts.ready.then(() => move(false));
    return () => observer.disconnect();
  }, []);
  return (
    <div className="tabs-scroll">
      <div ref={bar} className="t-tabs" role="tablist" aria-label={label}>
        <span ref={pill} className="t-tabs-pill" aria-hidden="true" />
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            className="t-tab"
            role="tab"
            aria-controls={panelId}
            aria-selected={value === option.value}
            tabIndex={value === option.value ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % options.length
                  : event.key === "ArrowLeft"
                    ? (index - 1 + options.length) % options.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? options.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              onChange(options[next]!.value);
              bar.current
                ?.querySelectorAll<HTMLButtonElement>(".t-tab")
                [next]?.focus();
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
