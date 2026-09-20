import {
  Activity,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "../controls/actions";
import { ControlPortalContext } from "../controls/controls";
import { X } from "../controls/icons";
import { ResultsMotion, motionDuration } from "../controls/motion";

const SurfacePortalContext = createContext<HTMLElement | null>(null);

/** Keep live input while hiding a locked surface, including its portalled controls. */
export function PreservedSurface({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setContainer}
      className="preserved-surface"
      hidden={!visible}
      inert={!visible}
      style={visible ? { display: "contents" } : { display: "none" }}
    >
      <SurfacePortalContext.Provider value={container}>
        <ControlPortalContext.Provider value={container}>
          <Activity mode={visible ? "visible" : "hidden"}>{children}</Activity>
        </ControlPortalContext.Provider>
      </SurfacePortalContext.Provider>
    </div>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  className = "",
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  /** Preserve the opener when asynchronous preparation temporarily disables it. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const surfaceContainer = useContext(SurfacePortalContext);
  const [present, setPresent] = useState(open);
  const [phase, setPhase] = useState("");
  const retained = useRef({ title, description, children });
  const content = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const setContent = useCallback((node: HTMLDivElement | null) => {
    content.current = node;
    setPortalContainer(node);
  }, []);
  const returnFocus = useRef<HTMLElement | null>(null);
  if (open) retained.current = { title, description, children };
  useLayoutEffect(() => {
    if (open) {
      if (!present || !returnFocus.current)
        returnFocus.current =
          returnFocusRef?.current ?? (document.activeElement as HTMLElement);
      setPresent(true);
      setPhase("");
    } else if (present) {
      setPhase("is-closing");
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const ms = motionDuration("--modal-close-dur", 150);
      const timer = setTimeout(
        () => {
          setPresent(false);
          setPhase("");
        },
        reduced ? 0 : ms,
      );
      return () => clearTimeout(timer);
    }
  }, [open]);
  useEffect(() => {
    if (!open || !present) return;
    const frame = requestAnimationFrame(() => {
      if (content.current) void content.current.offsetWidth;
      setPhase("is-open");
    });
    return () => cancelAnimationFrame(frame);
  }, [open, present]);
  return (
    <Dialog.Root open={present} onOpenChange={onOpenChange}>
      <Dialog.Portal container={surfaceContainer ?? undefined}>
        <Dialog.Overlay className={`dialog-overlay ${phase}`} />
        <div className="dialog-positioner">
          <Dialog.Content
            ref={setContent}
            inert={!open}
            onEscapeKeyDown={(event) => {
              // Radix handles Escape in capture; child popups and unfinished edits cancel first.
              if (
                content.current?.querySelector(
                  "[aria-haspopup][data-popup-open]",
                ) ||
                event
                  .composedPath()
                  .some(
                    (node) =>
                      node instanceof HTMLElement &&
                      node.dataset.escapeCancel === "true",
                  )
              )
                event.preventDefault();
            }}
            className={`dialog t-modal ${phase} ${wide ? "wide" : ""} ${className}`}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (document.querySelector('[role="dialog"].is-open')) return;
              if (returnFocus.current?.isConnected) returnFocus.current.focus();
              else document.getElementById("main-content")?.focus();
            }}
          >
            <div className="dialog-surface">
              <div className="dialog-heading">
                <div>
                  <Dialog.Title>{retained.current.title}</Dialog.Title>
                  <Dialog.Description>
                    {retained.current.description}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <Button variant="ghost" aria-label="Close dialog">
                    <X size={20} />
                  </Button>
                </Dialog.Close>
              </div>
              <ControlPortalContext.Provider value={portalContainer}>
                {retained.current.children}
              </ControlPortalContext.Provider>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Nonmodal on roomy screens; a focus-trapped dialog when the list and detail cannot fit. */
export function DetailPanel({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 1100px)").matches,
  );
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const retained = useRef({ title, children });
  if (open) retained.current = { title, children };
  useEffect(() => {
    const media = matchMedia("(max-width: 1100px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement;
      setPresent(true);
    } else {
      setShown(false);
      const ms = motionDuration("--panel-close-dur", 350);
      const timer = setTimeout(
        () => {
          setPresent(false);
          if (!narrow && returnFocus.current?.isConnected)
            returnFocus.current.focus({ preventScroll: true });
        },
        matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms,
      );
      return () => clearTimeout(timer);
    }
  }, [open]);
  useEffect(() => {
    if (!open || !present || narrow) return;
    const frame = requestAnimationFrame(() => {
      if (panel.current) void panel.current.offsetWidth;
      setShown(true);
      panel.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, present, narrow]);
  if (narrow)
    return (
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        title={title}
        description="Review order details and available actions."
      >
        {children}
      </Modal>
    );
  if (!present) return null;
  return (
    <aside
      className="detail-panel"
      data-open={open && shown}
      aria-label={retained.current.title}
      inert={!open}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="detail-panel-inner t-panel-slide"
        data-open={shown}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onOpenChange(false);
          }
        }}
      >
        <div className="detail-heading">
          <h2>{retained.current.title}</h2>
          <Button
            variant="ghost"
            aria-label="Close order details"
            onClick={() => onOpenChange(false)}
          >
            <X size={18} />
          </Button>
        </div>
        <ResultsMotion motionKey={retained.current.title}>
          {retained.current.children}
        </ResultsMotion>
      </div>
    </aside>
  );
}
