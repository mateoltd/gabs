import { useEffect, useState } from "react";
import type {
  ReferencePage,
  ReferenceQuery,
  ReferenceTarget,
} from "@suite/module-sdk/references";
import { Button, Field } from "./index";
import { Input, Select, SelectOption } from "./controls";

/** The host resolves a declared target; the form never receives arbitrary API access. */
export type ReferenceLoader = (
  target: ReferenceTarget,
  query: Omit<ReferenceQuery, "field"> & { limit: number },
  signal: AbortSignal,
) => Promise<ReferencePage & { offline?: boolean }>;
export function ReferencePicker({
  target,
  load,
  value,
  onChange,
  label,
  required,
  hint,
  invalid,
}: {
  target: ReferenceTarget;
  load: ReferenceLoader;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
  required?: boolean;
  hint?: string;
  invalid?: boolean;
}) {
  const key = JSON.stringify(target);
  const selected = typeof value === "string" && value ? value : undefined;
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [page, setPage] = useState<Awaited<ReturnType<ReferenceLoader>>>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    // Keep the current choices mounted while the next page or saved label resolves.
    const timer = setTimeout(
      () => {
        void load(
          JSON.parse(key) as ReferenceTarget,
          { search, cursor, selected, limit: 25 },
          controller.signal,
        )
          .then((page) => {
            if (!controller.signal.aborted) setPage(page);
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted) {
              setPage(undefined);
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not load reference choices.",
              );
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      search ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load, key, search, cursor, selected, retry]);
  const options = [...(page?.items ?? [])];
  if (
    selected &&
    !options.some((item) => item.value.toLowerCase() === selected.toLowerCase())
  )
    options.unshift(
      page?.selected?.value.toLowerCase() === selected.toLowerCase()
        ? page.selected
        : { value: selected, label: selected },
    );
  const selectedOption = options.find(
    (item) => item.value.toLowerCase() === selected?.toLowerCase(),
  );
  return (
    <div className="reference-picker form-stack">
      <Field label={label} hint={hint}>
        <Select
          aria-label={label}
          aria-invalid={invalid}
          aria-busy={loading}
          required={required}
          value={selectedOption?.value ?? ""}
          onValueChange={(value) => onChange(value || undefined)}
        >
          <SelectOption value="">Choose {label.toLowerCase()}</SelectOption>
          {options.map((item) => (
            <SelectOption key={item.value} value={item.value}>
              {item.label}
            </SelectOption>
          ))}
        </Select>
      </Field>
      <details className="resource-value">
        <summary>Find {label.toLowerCase()}</summary>
        <div className="form-stack">
          <Input
            aria-label={`Search ${label.toLowerCase()} choices`}
            value={search}
            maxLength={100}
            placeholder="Search by name"
            onChange={(event) => {
              setSearch(event.target.value);
              setCursor(undefined);
              setPrevious([]);
            }}
          />
          <p className="muted" role="status">
            {loading
              ? "Loading choices…"
              : page?.offline
                ? `${page.items.length} downloaded ${page.items.length === 1 ? "choice" : "choices"}. Connect to search more records.`
                : page
                  ? `${page.items.length} ${page.items.length === 1 ? "choice" : "choices"} on page ${previous.length + 1}.`
                  : "Choices unavailable."}
          </p>
          <div className="actions">
            <Button
              type="button"
              disabled={loading || !previous.length}
              onClick={() => {
                setCursor(previous.at(-1));
                setPrevious(previous.slice(0, -1));
              }}
            >
              Previous choices
            </Button>
            <Button
              type="button"
              disabled={loading || !page?.nextCursor}
              onClick={() => {
                setPrevious([...previous, cursor]);
                setCursor(page?.nextCursor ?? undefined);
              }}
            >
              Next choices
            </Button>
          </div>
        </div>
      </details>
      {selected && page?.selected === null && (
        <p className="muted" role="status">
          {page.offline
            ? "This value's label is not downloaded. Your saved selection is retained."
            : "This selection is no longer available. Choose an active record before saving."}
        </p>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button type="button" onClick={() => setRetry(retry + 1)}>
            Retry choices
          </Button>
        </div>
      )}
      {!required && selected && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onChange(undefined)}
        >
          Clear {label.toLowerCase()}
        </Button>
      )}
    </div>
  );
}
