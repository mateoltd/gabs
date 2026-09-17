export {
  ListPage,
  ListToolbar,
  ListTable,
  Table,
  SummaryStrip,
  RecordIdentity,
} from "./work-list";
import {
  Activity,
  createContext,
  useContext,
  cloneElement,
  isValidElement,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { type ReactNode, type ComponentProps, useId } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./shadcn/dropdown-menu";
export * from "./shadcn/breadcrumb";
export * from "./shadcn/dropdown-menu";
import { ControlPortalContext, Input } from "./controls";
import { Tooltip } from "./feedback";
export {
  Input,
  Textarea,
  Select,
  SelectOption,
  Checkbox,
  NumberInput,
} from "./controls";
export { Tooltip, FeedbackProvider, useToast } from "./feedback";
import { X, LoaderCircle, Search, AlertCircle, PackageOpen } from "./icons";
import { ResultsMotion, motionDuration } from "./motion";
export { ResultsMotion, ContentSkeleton } from "./motion";
export function Button({
  variant = "default",
  className = "",
  title,
  ...props
}: ComponentProps<"button"> & {
  variant?: "default" | "primary" | "danger" | "ghost";
}) {
  const button = (
    <button {...props} className={`button ${variant} ${className}`} />
  );
  return title || props["aria-label"] ? (
    <Tooltip content={title || props["aria-label"]}>{button}</Tooltip>
  ) : (
    button
  );
}
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
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
        returnFocus.current = document.activeElement as HTMLElement;
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

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId(),
    hintId = id + "-hint";
  return (
    <div className="field">
      <label id={id + "-label"} htmlFor={id}>
        {label}
      </label>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{
              id: string;
              "aria-describedby"?: string;
              "aria-labelledby"?: string;
            }>,
            {
              id,
              "aria-labelledby": id + "-label",
              ...(hint ? { "aria-describedby": hintId } : {}),
            },
          )
        : children}
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Status({
  status,
  label,
}: {
  status: string;
  label?: ReactNode;
}) {
  return (
    <span className={`status status-${status}`}>
      {label ?? status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function ActionMenu({
  trigger,
  title,
  description,
  items,
}: {
  trigger: ReactElement;
  title: string;
  description?: string;
  items: {
    label: string;
    icon?: ReactNode;
    disabled?: boolean;
    onSelect: () => void;
  }[];
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu
      onOpenChangeComplete={(open) => {
        if (open || !pendingAction.current) return;
        const action = pendingAction.current;
        pendingAction.current = null;
        requestAnimationFrame(() => {
          triggerRef.current?.focus();
          action();
        });
      }}
    >
      <DropdownMenuTrigger ref={triggerRef} render={trigger} />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {title}
            <small>{description}</small>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {items.map((item) => (
            <DropdownMenuItem
              key={item.label}
              disabled={item.disabled}
              onClick={() => {
                // Open the next surface after this menu releases its focus boundary.
                pendingAction.current = item.onSelect;
              }}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="error-message" role="alert">
      <AlertCircle size={18} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  );
}
export function Loading({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="empty loading-state" role="status">
      <LoaderCircle size={24} />
      <p>{label}</p>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <PackageOpen size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="search-field">
      <Search size={17} />
      <label className="sr-only" htmlFor={id}>
        {placeholder}
      </label>
      <Input
        autoFocus={autoFocus}
        ref={input}
        id={id}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label={`Clear ${placeholder.toLowerCase()}`}
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
export function Money({
  minor,
  currency = "EUR",
}: {
  minor: number;
  currency?: string;
}) {
  return (
    <>
      {new Intl.NumberFormat("en", { style: "currency", currency }).format(
        minor / 100,
      )}
    </>
  );
}
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
export {
  SchemaForm,
  TypedSchemaForm,
  HostCustomSandbox,
  fieldLabel,
  type FormSchema,
} from "./schema-form";
export {
  DataTable,
  VirtualList,
  TreeView,
  SplitPane,
  FileDropzone,
  ProgressBar,
  type DataColumn,
  type TreeNode,
} from "./data-components";

export { TypedResourceTable, ResourceValue } from "./resource-table";
export { TypedResourceSort } from "./resource-sort";
export { TypedResourceRanges } from "./resource-ranges";
export { TypedResourceFilters } from "./resource-filters";

export { ReferencePicker, type ReferenceLoader } from "./reference-picker";

export {
  useResourceList,
  type ResourceListQuery,
  type ResourceListState,
} from "./use-resource-list";
