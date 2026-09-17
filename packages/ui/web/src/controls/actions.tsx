import {
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./shadcn/dropdown-menu";
import { Tooltip } from "../overlays/feedback";

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
