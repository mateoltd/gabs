import { useContext, type ComponentProps } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { ControlPortalContext } from "./controls";
import { Check, Search, X } from "./icons";

export type SearchSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

/** Search a finite set without turning unrecognized text into a selected value. */
export function SearchSelect({
  options,
  value,
  onValueChange,
  disabled,
  name,
  required,
  className = "",
  placeholder = "Search choices",
  clearLabel = "Clear selection",
  ...input
}: Omit<ComponentProps<"input">, "value" | "onChange" | "children"> & {
  options: readonly SearchSelectOption[];
  value: string;
  onValueChange(value: string): void;
  clearLabel?: string;
}) {
  const container = useContext(ControlPortalContext);
  const byValue = new Map(options.map((option) => [option.value, option]));
  return (
    <Combobox.Root<string>
      items={options.map((option) => option.value)}
      value={byValue.has(value) ? value : null}
      onValueChange={(value) => onValueChange(value ?? "")}
      itemToStringLabel={(value) => byValue.get(value)?.label ?? value}
      disabled={disabled}
      name={name}
      required={required}
      openOnInputClick
      autoHighlight
    >
      <div className="search-field">
        <Search size={17} aria-hidden="true" />
        <Combobox.Input
          {...input}
          className={`input ${className}`}
          placeholder={placeholder}
        />
        <Combobox.Clear className="search-clear" aria-label={clearLabel}>
          <X size={14} aria-hidden="true" />
        </Combobox.Clear>
      </div>
      <Combobox.Portal container={container ?? undefined}>
        <Combobox.Positioner
          className="control-positioner"
          sideOffset={6}
          align="start"
        >
          <Combobox.Popup className="select-popup">
            <Combobox.Empty className="select-popup-label">
              No matching choices
            </Combobox.Empty>
            <Combobox.List
              className="select-list"
              aria-labelledby={input["aria-labelledby"]}
            >
              {(value: string) => (
                <Combobox.Item
                  key={value}
                  value={value}
                  disabled={byValue.get(value)?.disabled}
                  className="select-item"
                  data-value={value}
                >
                  {byValue.get(value)?.label}
                  <Combobox.ItemIndicator className="select-check">
                    <Check size={15} />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
