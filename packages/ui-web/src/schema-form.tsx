import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Input,
  Textarea,
  Select,
  SelectOption,
  Checkbox,
  NumberInput,
} from "./controls";
import { Field } from "./index";
export interface FormSchema {
  type?: string;
  properties?: Record<string, FormSchema>;
  required?: readonly string[];
  title?: string;
  enum?: readonly string[];
  anyOf?: readonly { const?: string }[];
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
}
export function fieldLabel(key: string) {
  return key
    .replace(/[_-]/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());
}
export function SchemaForm({
  schema,
  value,
  onChange,
  referenceOptions = {},
  fieldOrder = [],
}: {
  schema: FormSchema;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  referenceOptions?: Record<string, { value: string; label: string }[]>;
  fieldOrder?: readonly string[];
}) {
  return (
    <>
      {Object.entries(schema.properties ?? {})
        .sort(([a], [b]) => {
          const index = (key: string) =>
            fieldOrder.includes(key)
              ? fieldOrder.indexOf(key)
              : fieldOrder.length;
          return index(a) - index(b);
        })
        .map(([key, field]) => {
          const label = field.title ?? fieldLabel(key),
            required = schema.required?.includes(key),
            current = value[key];
          const update = (v: unknown) => {
            const next = { ...value };
            if (v === "" && !required) delete next[key];
            else next[key] = v;
            onChange(next);
          };
          const options =
            referenceOptions[key] ??
            (
              field.enum ??
              field.anyOf?.map((v) => v.const).filter((v): v is string => !!v)
            )?.map((v) => ({ value: v, label: fieldLabel(v) }));
          return (
            <Field key={key} label={label}>
              {options ? (
                <Select
                  aria-label={label}
                  value={String(current ?? "")}
                  onValueChange={update}
                  required={required}
                >
                  <SelectOption value="">
                    Choose {label.toLowerCase()}
                  </SelectOption>
                  {options.map((v) => (
                    <SelectOption key={v.value} value={v.value}>
                      {v.label}
                    </SelectOption>
                  ))}
                </Select>
              ) : field.type === "boolean" ? (
                <Checkbox
                  aria-label={label}
                  checked={Boolean(current)}
                  onCheckedChange={update}
                />
              ) : field.type === "number" || field.type === "integer" ? (
                <Input
                  aria-label={label}
                  type="number"
                  step={field.type === "integer" ? 1 : "any"}
                  value={current === undefined ? "" : String(current)}
                  min={field.minimum}
                  max={field.maximum}
                  required={required}
                  onChange={(e) =>
                    update(e.target.value === "" ? "" : Number(e.target.value))
                  }
                />
              ) : field.maxLength && field.maxLength > 1000 ? (
                <Textarea
                  aria-label={label}
                  value={String(current ?? "")}
                  maxLength={field.maxLength}
                  required={required}
                  onChange={(e) => update(e.target.value)}
                />
              ) : (
                <Input
                  aria-label={label}
                  type={key.toLowerCase().includes("date") ? "date" : "text"}
                  value={String(current ?? "")}
                  maxLength={field.maxLength}
                  minLength={field.minLength}
                  required={required}
                  onChange={(e) => update(e.target.value)}
                />
              )}
            </Field>
          );
        })}
    </>
  );
}
export function HostCustomSandbox({
  children,
  css,
  label,
}: {
  children: ReactNode;
  css: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot>();
  useEffect(() => {
    if (ref.current)
      setRoot(
        ref.current.shadowRoot ?? ref.current.attachShadow({ mode: "open" }),
      );
  }, []);
  return (
    <div ref={ref} role="region" aria-label={label}>
      {root &&
        createPortal(
          <>
            <style>{`:host{all:initial;display:block;contain:content;color:#111;background:#fff;font:16px system-ui}*{box-sizing:border-box}${css}`}</style>
            {children}
          </>,
          root,
        )}
    </div>
  );
}
