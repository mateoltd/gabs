import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useContext,
  useId,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Input as BaseInput } from "@base-ui/react/input";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { NumberField } from "@base-ui/react/number-field";
import { Check, ChevronDown } from "./icons";

// Keep portalled controls inside a containing dialog's focus and dismissal boundary.
export const ControlPortalContext = createContext<HTMLElement | null>(null);
export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <BaseInput {...props} className={`input ${className}`} />;
}

export function Textarea({
  className = "",
  ...props
}: ComponentProps<"textarea">) {
  return <textarea {...props} className={`textarea ${className}`} />;
}

type OptionProps = { value: string; children: ReactNode; disabled?: boolean };
/** Declarative option data, rendered by Select as an accessible listbox item. */
export function SelectOption(_props: OptionProps) {
  return null;
}

export function Select({
  value,
  onValueChange,
  children,
  required,
  disabled,
  name,
  id,
  leading,
  popupLabel,
  popupClassName = "",
  className = "",
  ...props
}: Omit<ComponentProps<"button">, "value" | "onChange" | "children"> & {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  required?: boolean;
  leading?: ReactNode;
  popupLabel?: string;
  popupClassName?: string;
}) {
  const container = useContext(ControlPortalContext);
  const generatedId = useId();
  id ??= generatedId;
  function collect(
    nodes: ReactNode,
  ): { value: string; label: ReactNode; disabled?: boolean }[] {
    return Children.toArray(nodes).flatMap((child) => {
      if (!isValidElement<OptionProps>(child)) return [];
      if (child.type === Fragment) return collect(child.props.children);
      return child.type === SelectOption
        ? [
            {
              value: child.props.value,
              label: child.props.children,
              disabled: child.props.disabled,
            },
          ]
        : [];
    });
  }
  const options = collect(children);
  const placeholder = options.find((option) => option.value === "")?.label;
  const items = options.filter((option) => option.value !== "");
  return (
    <BaseSelect.Root
      value={value || null}
      onValueChange={(next, details) => {
        // A changing async option list can briefly unregister a still-present item.
        // Keep controlled values until the caller actually removes or clears them.
        if (
          next === null &&
          details.reason === "none" &&
          value &&
          items.some((item) => item.value === value)
        ) {
          details.cancel();
          return;
        }
        onValueChange(next ?? "");
      }}
      items={items}
      required={required}
      disabled={disabled}
      name={name}
      id={id}
    >
      <BaseSelect.Trigger {...props} className={`select-trigger ${className}`}>
        {leading}
        <BaseSelect.Value
          className="select-value"
          placeholder={placeholder ?? "Choose an option"}
        />
        <BaseSelect.Icon className="select-icon">
          <ChevronDown size={16} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={container ?? undefined}>
        <BaseSelect.Positioner
          className="control-positioner"
          sideOffset={6}
          align="start"
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup
            className={`select-popup t-dropdown ${popupClassName}`}
            render={(popupProps, state) => (
              <div
                {...popupProps}
                aria-hidden={state.open ? undefined : true}
                inert={state.open ? undefined : true}
              />
            )}
          >
            {popupLabel && (
              <div className="select-popup-label">{popupLabel}</div>
            )}
            <BaseSelect.ScrollUpArrow className="select-scroll-arrow">
              <ChevronDown size={14} />
            </BaseSelect.ScrollUpArrow>
            <BaseSelect.List
              className="select-list"
              aria-label={popupLabel}
              aria-labelledby={
                props["aria-labelledby"] ?? (popupLabel ? undefined : id)
              }
            >
              {items.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className="select-item"
                  data-value={option.value}
                >
                  <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="select-check">
                    <Check size={15} />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
            <BaseSelect.ScrollDownArrow className="select-scroll-arrow">
              <ChevronDown size={14} />
            </BaseSelect.ScrollDownArrow>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

export function Checkbox({
  className = "",
  indeterminate,
  ...props
}: Omit<BaseCheckbox.Root.Props, "className"> & { className?: string }) {
  return (
    <BaseCheckbox.Root
      {...props}
      indeterminate={indeterminate}
      className={`checkbox ${className}`}
    >
      <BaseCheckbox.Indicator className="checkbox-indicator">
        {indeterminate ? (
          <span className="checkbox-mixed" />
        ) : (
          <Check size={13} />
        )}
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

export function NumberInput({
  value,
  onValueChange,
  id,
  name,
  min,
  max,
  step = 1,
  required,
  disabled,
  readOnly,
  className = "",
  ...props
}: Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "type" | "min" | "max" | "step"
> & {
  value: string | number;
  onValueChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number | string;
}) {
  return (
    <NumberField.Root
      id={id}
      name={name}
      value={value === "" ? null : Number(value)}
      onValueChange={(next) => onValueChange(next === null ? "" : String(next))}
      min={min}
      max={max}
      step={Number(step)}
      required={required}
      disabled={disabled}
      readOnly={readOnly}
      allowOutOfRange
      format={{ useGrouping: false }}
      className={`number-field ${className}`}
    >
      <NumberField.Group className="number-group">
        <NumberField.Input {...props} className="number-input" />
        <div className="number-steppers">
          <NumberField.Increment
            className="number-step"
            aria-label="Increase value"
          >
            <ChevronDown size={12} />
          </NumberField.Increment>
          <NumberField.Decrement
            className="number-step"
            aria-label="Decrease value"
          >
            <ChevronDown size={12} />
          </NumberField.Decrement>
        </div>
      </NumberField.Group>
    </NumberField.Root>
  );
}
