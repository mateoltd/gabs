import { ReferencePicker, type ReferenceLoader } from "./reference-picker";
import { referenceTarget } from "@suite/module-sdk/references";
import { createPortal } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Input,
  Textarea,
  Select,
  SelectOption,
  Checkbox,
  ControlPortalContext,
} from "../controls/controls";
import { Button } from "../controls/actions";
import { Field } from "./fields";
import {
  createSchemaDraft,
  objectPropertySchema,
  parseSchemaInput,
  type SchemaDraft,
  type SchemaIssue,
} from "@suite/module-sdk/forms";
import type { Static, TObject, TSchema } from "@suite/module-sdk";

export interface FormSchema {
  "x-reference"?: unknown;
  "x-membership"?: unknown;
  type?: string;
  properties?: Record<string, FormSchema>;
  required?: readonly string[];
  title?: string;
  description?: string;
  const?: unknown;
  enum?: readonly unknown[];
  anyOf?: readonly FormSchema[];
  allOf?: readonly FormSchema[];
  items?: FormSchema | readonly FormSchema[];
  additionalProperties?: boolean | FormSchema;
  patternProperties?: Record<string, FormSchema>;
  minProperties?: number;
  maxProperties?: number;
  default?: unknown;
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  pattern?: string;
  format?: string;
}
export function fieldLabel(key: string) {
  return key
    .replace(/[_-]/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());
}
const pointer = (path: string, key: string | number) =>
  `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const draft = (schema: FormSchema) => createSchemaDraft(schema as TSchema);
type References = Record<string, { value: string; label: string }[]>;
interface FieldProps {
  schema: FormSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
  path: string;
  required?: boolean;
  references: References;
  issues: SchemaIssue[];
}
const ReferenceLoading = createContext<ReferenceLoader | undefined>(undefined);
const InvalidFields = createContext<(path: string, invalid: boolean) => void>(
  () => {},
);
function JsonField({
  schema,
  value,
  onChange,
  label,
  path,
  required,
  issues,
  onInvalidChange,
}: FieldProps & { onInvalidChange?: (invalid: boolean) => void }) {
  const issue = issues.find(
    (issue) => issue.path === path || issue.path.startsWith(`${path}/`),
  );
  const serialized = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [text, setText] = useState(serialized),
    [error, setError] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const report = useContext(InvalidFields);
  const invalid =
    !!error || (!!required && value === undefined && !text.trim());
  useEffect(() => {
    setText(serialized);
    setError("");
  }, [serialized]);
  useEffect(() => {
    ref.current?.setCustomValidity(error);
    report(path, invalid);
    onInvalidChange?.(invalid);
    return () => {
      report(path, false);
      onInvalidChange?.(false);
    };
  }, [error, invalid, path, report, onInvalidChange]);
  return (
    <Field
      label={label}
      hint={
        error ||
        issue?.message ||
        schema.description ||
        "Enter JSON matching this field's schema."
      }
    >
      <Textarea
        ref={ref}
        aria-label={label}
        aria-invalid={!!error || !!issue}
        required={required}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (!next.trim() && !required) {
            setError("");
            onChange(undefined);
            return;
          }
          try {
            const parsed: unknown = JSON.parse(next);
            const result = parseSchemaInput(schema as TSchema, parsed);
            if (!result.ok) {
              setError(
                result.issues
                  .map((issue) => `${issue.path || label}: ${issue.message}`)
                  .join("; "),
              );
              return;
            }
            setError("");
            onChange(parsed);
          } catch {
            setError("Enter valid JSON before saving.");
          }
        }}
      />
    </Field>
  );
}
function Group({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <fieldset
      className="schema-group form-stack"
      aria-describedby={hint || error ? id : undefined}
      aria-invalid={!!error}
    >
      <legend>{label}</legend>
      {(hint || error) && (
        <p id={id} className={error ? "schema-error" : "schema-hint"}>
          {error ?? hint}
        </p>
      )}
      {children}
    </fieldset>
  );
}
function ObjectFields({
  schema,
  value,
  onChange,
  path,
  references,
  issues,
  fieldOrder = [],
  label: groupLabel,
}: Omit<FieldProps, "label"> & {
  fieldOrder?: readonly string[];
  label?: string;
}) {
  const values = object(value);
  return (
    <>
      {Object.entries(schema.properties ?? {})
        .sort(([a], [b]) => {
          const index = (name: string) =>
            fieldOrder.includes(name)
              ? fieldOrder.indexOf(name)
              : fieldOrder.length;
          return index(a) - index(b);
        })
        .map(([key, field]) => (
          <SchemaField
            key={key}
            schema={field}
            label={field.title ?? fieldLabel(key)}
            value={Object.hasOwn(values, key) ? values[key] : undefined}
            required={schema.required?.includes(key)}
            path={pointer(path, key)}
            references={references}
            issues={issues}
            onChange={(value) => {
              const next = { ...values };
              if (value === undefined) delete next[key];
              else
                Object.defineProperty(next, key, {
                  value,
                  writable: true,
                  enumerable: true,
                  configurable: true,
                });
              onChange(next);
            }}
          />
        ))}
      {(schema.patternProperties ||
        typeof schema.additionalProperties === "object" ||
        schema.additionalProperties === true) && (
        <MapFields
          schema={schema}
          value={value}
          onChange={onChange}
          path={path}
          label={groupLabel ?? schema.title ?? "Additional fields"}
          references={references}
          issues={issues}
        />
      )}
    </>
  );
}
function MapFields(props: FieldProps) {
  const { schema, value, onChange, path, label } = props;
  const values = object(value);
  const keys = Object.keys(values).filter(
    (key) => !Object.hasOwn(schema.properties ?? {}, key),
  );
  const identities = useRef(new Map<string, string>());
  const [newKey, setNewKey] = useState(""),
    [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const report = useContext(InvalidFields),
    id = useId();
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      error || (newKey ? "Add the entry, or press Escape to cancel." : ""),
    );
    report(`${path}:new:${id}`, !!newKey || !!error);
    return () => report(`${path}:new:${id}`, false);
  }, [newKey, error, report, path, id]);
  const keyIssue = (key: string, prior?: string) => {
    if (key === "__proto__")
      return "This key is reserved. Choose another name.";
    if (key !== prior && Object.hasOwn(values, key))
      return "This key already exists.";
    if (Object.hasOwn(schema.properties ?? {}, key))
      return "This key is a declared field. Edit it in its own control.";
    if (!objectPropertySchema(schema as TSchema, key))
      return "This key does not match a declared field pattern.";
    return "";
  };
  const add = () => {
    const issue = keyIssue(newKey);
    if (issue) {
      setError(issue);
      return;
    }
    if (
      schema.maxProperties !== undefined &&
      Object.keys(values).length >= schema.maxProperties
    ) {
      setError("Remove an entry before adding another.");
      return;
    }
    const entry = objectPropertySchema(schema as TSchema, newKey)!;
    const next = { ...values };
    Object.defineProperty(next, newKey, {
      value: draft(entry),
      writable: true,
      enumerable: true,
      configurable: true,
    });
    onChange(next);
    setNewKey("");
    setError("");
  };
  return (
    <>
      {keys.map((key, index) => {
        if (!identities.current.has(key))
          identities.current.set(key, crypto.randomUUID());
        return (
          <MapEntry
            key={identities.current.get(key)}
            {...props}
            entryKey={key}
            index={index}
            keyIssue={keyIssue}
            rename={(nextKey) => {
              const next = Object.fromEntries(
                Object.entries(values).map(([name, value]) => [
                  name === key ? nextKey : name,
                  value,
                ]),
              );
              identities.current.set(nextKey, identities.current.get(key)!);
              identities.current.delete(key);
              onChange(next);
            }}
            remove={() => {
              const next = { ...values };
              delete next[key];
              identities.current.delete(key);
              onChange(next);
            }}
          />
        );
      })}
      <Field
        label={`New key for ${label.toLowerCase()}`}
        hint={
          error ||
          (newKey ? "Add the entry, or press Escape to cancel." : undefined)
        }
      >
        <Input
          ref={inputRef}
          data-escape-cancel={newKey || error ? "true" : undefined}
          value={newKey}
          aria-invalid={!!error}
          onChange={(event) => {
            setNewKey(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            } else if (event.key === "Escape" && (newKey || error)) {
              event.preventDefault();
              event.stopPropagation();
              setNewKey("");
              setError("");
            }
          }}
        />
      </Field>
      <Button
        type="button"
        disabled={
          schema.maxProperties !== undefined &&
          Object.keys(values).length >= schema.maxProperties
        }
        onClick={add}
      >
        Add {label.toLowerCase()} entry
      </Button>
    </>
  );
}
function MapEntry(
  props: FieldProps & {
    entryKey: string;
    index: number;
    keyIssue: (key: string, prior?: string) => string;
    rename: (key: string) => void;
    remove: () => void;
  },
) {
  const {
    entryKey,
    index,
    keyIssue,
    rename,
    remove,
    schema,
    value,
    onChange,
    path,
    label,
    references,
    issues,
  } = props;
  const [key, setKey] = useState(entryKey),
    [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const report = useContext(InvalidFields),
    id = useId();
  useEffect(() => {
    setKey(entryKey);
    setError("");
  }, [entryKey]);
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      error ||
        (key !== entryKey
          ? "Apply the new key, or press Escape to cancel."
          : ""),
    );
    report(`${path}:rename:${id}`, key !== entryKey || !!error);
    return () => report(`${path}:rename:${id}`, false);
  }, [key, entryKey, error, report, path, id]);
  const apply = () => {
    if (key === entryKey) {
      setError("");
      return;
    }
    const issue = keyIssue(key, entryKey);
    if (issue) {
      setError(issue);
      return;
    }
    rename(key);
    setError("");
  };
  const values = object(value),
    entry = objectPropertySchema(schema as TSchema, entryKey) ?? {};
  return (
    <div className="schema-array-item form-stack">
      <Field
        label={`${label} key ${index + 1}`}
        hint={
          error ||
          (key !== entryKey
            ? "Apply the new key, or press Escape to cancel."
            : undefined)
        }
      >
        <Input
          ref={inputRef}
          data-escape-cancel={key !== entryKey || error ? "true" : undefined}
          value={key}
          aria-invalid={!!error}
          onChange={(event) => {
            setKey(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            } else if (event.key === "Escape" && (key !== entryKey || error)) {
              event.preventDefault();
              event.stopPropagation();
              setKey(entryKey);
              setError("");
            }
          }}
        />
      </Field>
      <SchemaField
        schema={entry}
        label={`${label}: ${entryKey || "Empty key"}`}
        value={values[entryKey]}
        path={pointer(path, entryKey)}
        required
        references={references}
        issues={issues}
        onChange={(next) => onChange({ ...values, [entryKey]: next })}
      />
      <div className="actions">
        <Button
          type="button"
          variant="ghost"
          disabled={key === entryKey}
          onClick={apply}
        >
          Rename {label.toLowerCase()} entry {index + 1}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={Object.keys(values).length <= (schema.minProperties ?? 0)}
          onClick={remove}
        >
          Remove {label.toLowerCase()} entry {index + 1}
        </Button>
      </div>
    </div>
  );
}
function SchemaField(props: FieldProps): ReactNode {
  const loadReference = useContext(ReferenceLoading);
  const [chosen, setChosen] = useState(-1);
  const [jsonMode, setJsonMode] = useState(false),
    [invalidJson, setInvalidJson] = useState(false);
  const report = useContext(InvalidFields);
  const [invalidChildren, setInvalidChildren] = useState<
    Record<string, boolean>
  >({});
  const trackInvalid = useCallback(
    (key: string, invalid: boolean) => {
      report(key, invalid);
      setInvalidChildren((current) => {
        if (!!current[key] === invalid) return current;
        const next = { ...current };
        if (invalid) next[key] = true;
        else delete next[key];
        return next;
      });
    },
    [report],
  );
  const rowKeys = useRef<string[]>([]);
  const { schema, value, onChange, label, path, required, references, issues } =
    props;
  const error = issues.find((issue) => issue.path === path)?.message;
  const nullable = schema.anyOf?.find((option) => option.type === "null");
  const nonNull = schema.anyOf?.filter((option) => option.type !== "null");
  if (nullable && nonNull?.length === 1)
    return (
      <Group label={label} hint={schema.description} error={error}>
        <Field label={`No value for ${label.toLowerCase()}`}>
          <Checkbox
            checked={value === null}
            onCheckedChange={(checked) =>
              onChange(checked ? null : draft(nonNull[0]))
            }
          />
        </Field>
        {value !== null && <SchemaField {...props} schema={nonNull[0]} />}
      </Group>
    );
  const map =
    schema.type === "object" &&
    (schema.patternProperties ||
      typeof schema.additionalProperties === "object" ||
      schema.additionalProperties === true);
  const tuple =
    schema.type === "array" &&
    (Array.isArray(schema.items) || schema.maxItems === 0);
  if ((schema.type === "object" && (schema.properties || map)) || tuple) {
    const entries = Array.isArray(schema.items) ? schema.items : [];
    const rows = Array.isArray(value)
      ? value
      : ((draft(schema) as unknown[]) ?? []);
    return (
      <Group label={label} hint={schema.description} error={error}>
        <InvalidFields.Provider value={trackInvalid}>
          {!required && value === undefined ? (
            <Button type="button" onClick={() => onChange(draft(schema))}>
              Add {label.toLowerCase()}
            </Button>
          ) : (
            <>
              {jsonMode ? (
                <JsonField {...props} onInvalidChange={setInvalidJson} />
              ) : tuple ? (
                <>
                  {entries.map((entry, index) => (
                    <SchemaField
                      key={index}
                      schema={entry}
                      label={entry.title ?? `${label} ${index + 1}`}
                      path={pointer(path, index)}
                      value={rows[index]}
                      required
                      references={references}
                      issues={issues}
                      onChange={(next) => {
                        const values = Array.from(
                          { length: Math.max(rows.length, entries.length) },
                          (_, i) => rows[i],
                        );
                        values[index] = next;
                        onChange(values);
                      }}
                    />
                  ))}
                  {rows.length > entries.length && (
                    <>
                      <p className="schema-error">
                        This tuple has extra values. Use the JSON editor to
                        review them.
                      </p>
                    </>
                  )}
                </>
              ) : (
                <ObjectFields {...props} />
              )}
              {(map || tuple) && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={Object.keys(invalidChildren).length > 0}
                  onClick={() => setJsonMode(!jsonMode)}
                >
                  {jsonMode
                    ? `Use structured ${label.toLowerCase()} editor`
                    : `Edit ${label.toLowerCase()} as JSON`}
                </Button>
              )}
              {jsonMode && invalidJson && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setJsonMode(false);
                    setInvalidJson(false);
                  }}
                >
                  Discard JSON edits
                </Button>
              )}
              {!required && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onChange(undefined)}
                >
                  Remove {label.toLowerCase()}
                </Button>
              )}
            </>
          )}
        </InvalidFields.Provider>
      </Group>
    );
  }
  if (schema.type === "array" && schema.items && !Array.isArray(schema.items)) {
    const rows = Array.isArray(value) ? value : [];
    while (rowKeys.current.length < rows.length)
      rowKeys.current.push(crypto.randomUUID());
    rowKeys.current.length = rows.length;
    const item = schema.items as FormSchema;
    return (
      <Group label={label} hint={schema.description} error={error}>
        {rows.map((entry, index) => (
          <div
            className="schema-array-item form-stack"
            key={rowKeys.current[index]}
          >
            <SchemaField
              schema={item}
              label={`${label} ${index + 1}`}
              path={pointer(path, index)}
              value={entry}
              required
              references={references}
              issues={issues}
              onChange={(next) =>
                onChange(rows.map((row, i) => (i === index ? next : row)))
              }
            />
            <Button
              type="button"
              variant="ghost"
              disabled={rows.length <= (schema.minItems ?? 0)}
              onClick={() => {
                rowKeys.current.splice(index, 1);
                onChange(rows.filter((_row, i) => i !== index));
              }}
            >
              Remove {label.toLowerCase()} {index + 1}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          disabled={
            schema.maxItems !== undefined && rows.length >= schema.maxItems
          }
          onClick={() =>
            onChange([
              ...rows,
              draft(item) ?? (item.type === "string" ? "" : undefined),
            ])
          }
        >
          Add {label.toLowerCase()} item
        </Button>
        {!required && value !== undefined && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange(undefined)}
          >
            Remove {label.toLowerCase()}
          </Button>
        )}
      </Group>
    );
  }
  const target = referenceTarget(schema);
  if (target && loadReference)
    return (
      <ReferencePicker
        target={target}
        load={loadReference}
        value={value}
        onChange={onChange}
        label={label}
        required={required}
        hint={error ?? schema.description}
        invalid={!!error}
      />
    );
  let choices =
    schema.enum ??
    (schema.anyOf?.every((option) => Object.hasOwn(option, "const"))
      ? schema.anyOf.map((option) => option.const)
      : undefined);
  if (schema.type === "boolean" && !Object.hasOwn(schema, "const"))
    return (
      <Field label={label} hint={error ?? schema.description}>
        <Checkbox
          aria-label={label}
          aria-invalid={!!error}
          checked={value === true}
          onCheckedChange={onChange}
        />
      </Field>
    );
  if (Object.hasOwn(schema, "const")) choices = [schema.const];
  const legacyKey = path.slice(1).replaceAll("~1", "/").replaceAll("~0", "~");
  const reference = Object.hasOwn(references, path)
    ? references[path]
    : !path.slice(1).includes("/") && Object.hasOwn(references, legacyKey)
      ? references[legacyKey]
      : undefined;
  if (choices || reference) {
    const plain = choices?.every(
      (choice) => typeof choice === "string" && choice !== "",
    );
    const options =
      reference?.map((option) => ({ ...option, data: option.value })) ??
      choices!.map((choice, index) => ({
        value: plain ? String(choice) : `choice:${index}`,
        label:
          typeof choice === "boolean"
            ? choice
              ? "Yes"
              : "No"
            : choice === ""
              ? "Empty text"
              : choice === null
                ? "No value"
                : fieldLabel(String(choice)),
        data: choice,
      }));
    const selected = options.find((option) => Object.is(option.data, value));
    return (
      <Field label={label} hint={error ?? schema.description}>
        <Select
          aria-label={label}
          aria-invalid={!!error}
          required={required}
          value={selected?.value ?? ""}
          onValueChange={(key) =>
            onChange(options.find((option) => option.value === key)?.data)
          }
        >
          <SelectOption value="">Choose {label.toLowerCase()}</SelectOption>
          {options.map((option) => (
            <SelectOption key={option.value} value={option.value}>
              {option.label}
            </SelectOption>
          ))}
        </Select>
      </Field>
    );
  }
  if (schema.anyOf) {
    const inferred = schema.anyOf.findIndex((option) => {
      const literals = Object.entries(option.properties ?? {}).filter(
        ([, field]) => Object.hasOwn(field, "const"),
      );
      return literals.length
        ? literals.every(([key, field]) =>
            Object.is(object(value)[key], field.const),
          )
        : parseSchemaInput(option as TSchema, value).ok;
    });
    const selected =
      inferred >= 0 ? inferred : chosen < schema.anyOf.length ? chosen : -1;
    return (
      <Group label={label} hint={schema.description} error={error}>
        <Field label={`${label} format`}>
          <Select
            value={selected < 0 ? "" : String(selected + 1)}
            onValueChange={(key) => {
              const index = Number(key) - 1;
              setChosen(index);
              onChange(index >= 0 ? draft(schema.anyOf![index]) : undefined);
            }}
          >
            <SelectOption value="">Choose a format</SelectOption>
            {schema.anyOf.map((option, index) => (
              <SelectOption key={index} value={String(index + 1)}>
                {option.title ?? `Option ${index + 1}`}
              </SelectOption>
            ))}
          </Select>
        </Field>
        {selected >= 0 && (
          <SchemaField
            {...props}
            schema={schema.anyOf[selected]}
            label={schema.anyOf[selected].title ?? label}
          />
        )}
      </Group>
    );
  }
  const updateText = (text: string) =>
    onChange(text === "" && !required ? undefined : text);
  const common = { "aria-label": label, "aria-invalid": !!error, required };
  if (schema.type === "number" || schema.type === "integer")
    return (
      <Field label={label} hint={error ?? schema.description}>
        <Input
          {...common}
          type="number"
          step={schema.multipleOf ?? (schema.type === "integer" ? 1 : "any")}
          value={typeof value === "number" ? value : ""}
          min={schema.minimum}
          max={schema.maximum}
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? undefined
                : Number(event.target.value),
            )
          }
        />
      </Field>
    );
  if (schema.type === "string")
    return (
      <Field label={label} hint={error ?? schema.description}>
        {schema.maxLength && schema.maxLength > 1000 ? (
          <Textarea
            {...common}
            value={typeof value === "string" ? value : ""}
            minLength={schema.minLength}
            maxLength={schema.maxLength}
            onChange={(event) => updateText(event.target.value)}
          />
        ) : (
          <Input
            {...common}
            type={
              schema.format === "email"
                ? "email"
                : schema.format === "uri"
                  ? "url"
                  : schema.format === "date" ||
                      schema.pattern === "^\\d{4}-\\d{2}-\\d{2}$"
                    ? "date"
                    : "text"
            }
            value={typeof value === "string" ? value : ""}
            minLength={schema.minLength}
            maxLength={schema.maxLength}
            pattern={schema.pattern}
            onChange={(event) => updateText(event.target.value)}
          />
        )}
      </Field>
    );
  return <JsonField {...props} />;
}
interface SchemaFormProps {
  schema: FormSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  referenceOptions?: References;
  loadReferences?: ReferenceLoader;
  fieldOrder?: readonly string[];
  validate?: boolean;
  onValidityChange?: (valid: boolean) => void;
}
export function SchemaForm({
  schema,
  value,
  onChange,
  referenceOptions = {},
  loadReferences,
  fieldOrder = [],
  validate = false,
  onValidityChange,
}: SchemaFormProps) {
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>(
    {},
  );
  const report = useCallback(
    (path: string, invalid: boolean) =>
      setInvalidFields((current) => {
        if (!!current[path] === invalid) return current;
        const next = { ...current };
        if (invalid) next[path] = true;
        else delete next[path];
        return next;
      }),
    [],
  );
  const result =
    validate || onValidityChange
      ? parseSchemaInput(schema as TSchema, value)
      : undefined;
  const valid = !Object.keys(invalidFields).length && (result?.ok ?? true);
  useEffect(() => onValidityChange?.(valid), [onValidityChange, valid]);
  const issues = validate && result && !result.ok ? result.issues : [];
  return (
    <ReferenceLoading.Provider value={loadReferences}>
      <InvalidFields.Provider value={report}>
        <ObjectFields
          schema={schema}
          value={value}
          onChange={(value) => onChange(object(value))}
          path=""
          references={referenceOptions}
          issues={issues}
          fieldOrder={fieldOrder}
        />
        {issues.length > 0 && (
          <div className="schema-errors" role="alert">
            <p>Review the marked fields before saving.</p>
            <ul>
              {issues.map((issue, index) => (
                <li key={index}>
                  {issue.path || "Record"}: {issue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </InvalidFields.Provider>
    </ReferenceLoading.Provider>
  );
}
/** The schema alone determines draft field names and values in custom module views. */
export function TypedSchemaForm<S extends TObject>({
  schema,
  value,
  onChange,
  ...props
}: Omit<SchemaFormProps, "schema" | "value" | "onChange" | "fieldOrder"> & {
  schema: S;
  value: SchemaDraft<Static<NoInfer<S>>>;
  onChange: (value: SchemaDraft<Static<S>>) => void;
  fieldOrder?: readonly (keyof Static<NoInfer<S>> & string)[];
}) {
  return (
    <SchemaForm
      {...props}
      schema={schema}
      value={value as Record<string, unknown>}
      onChange={(next) => onChange(next as SchemaDraft<Static<S>>)}
    />
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
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
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
            <style>{`:host{all:initial;display:block;contain:style;min-width:0;color:var(--text);background:var(--surface);font:inherit;line-height:1.5}*{box-sizing:border-box}${css}`}</style>
            <div ref={setPortalContainer}>
              <ControlPortalContext.Provider value={portalContainer}>
                {children}
              </ControlPortalContext.Provider>
            </div>
          </>,
          root,
        )}
    </div>
  );
}
