import {
  cloneElement,
  isValidElement,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Input } from "../controls/controls";
import { Search, X } from "../controls/icons";

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
