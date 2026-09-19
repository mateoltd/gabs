import {
  useContext,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { Toast } from "@base-ui/react/toast";
import { CheckCircle2, X } from "../controls/icons";
import { ControlPortalContext } from "../controls/controls";

export function Tooltip({
  children,
  content,
  side = "top",
}: {
  children: ReactElement;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  const container = useContext(ControlPortalContext);
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <BaseTooltip.Root open={open} onOpenChange={setOpen}>
      <BaseTooltip.Trigger
        render={children}
        aria-describedby={open ? id : undefined}
      />
      <BaseTooltip.Portal container={container ?? undefined}>
        <BaseTooltip.Positioner
          className="tooltip-positioner"
          side={side}
          sideOffset={8}
        >
          <BaseTooltip.Popup id={id} role="tooltip" className="tooltip-popup">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export function FeedbackProvider({
  children,
  label = "Notifications",
}: {
  children: ReactNode;
  label?: string;
}) {
  const container = useContext(ControlPortalContext);
  return (
    <BaseTooltip.Provider delay={450}>
      <Toast.Provider timeout={5000} limit={3}>
        {children}
        <Toast.Portal container={container ?? undefined}>
          <Toast.Viewport className="toast-viewport" aria-label={label}>
            <ToastList />
          </Toast.Viewport>
        </Toast.Portal>
      </Toast.Provider>
    </BaseTooltip.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className={`toast t-toast ${toast.transitionStatus ? "" : "is-open"}`}
    >
      <Toast.Content className="toast-content">
        <CheckCircle2 size={19} className="toast-icon" />
        <div className="toast-text">
          <Toast.Title className="toast-title" />
          <Toast.Description className="toast-description" />
        </div>
        <Toast.Close
          className="toast-close"
          aria-label="Dismiss notification"
          aria-hidden={false}
        >
          <X size={15} />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}

export const useToast = Toast.useToastManager;
