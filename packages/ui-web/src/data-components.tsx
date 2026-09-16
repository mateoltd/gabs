import { Table } from "./work-list";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Input } from "./index";
export interface DataColumn<T> {
  key: keyof T & string;
  label: string;
  render?: (value: T) => ReactNode;
}
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
}: {
  rows: readonly T[];
  columns: readonly DataColumn<T>[];
  rowKey: (row: T) => string;
  caption: string;
}) {
  const [sort, setSort] = useState<{ key: keyof T; descending: boolean }>(),
    [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const filtered = rows.filter((row) =>
      columns.some((c) =>
        String(row[c.key] ?? "")
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
      ),
    );
    if (sort)
      filtered.sort(
        (a, b) =>
          String(a[sort.key] ?? "").localeCompare(
            String(b[sort.key] ?? ""),
            undefined,
            { numeric: true },
          ) * (sort.descending ? -1 : 1),
      );
    return filtered;
  }, [rows, columns, search, sort]);
  return (
    <div>
      <Input
        aria-label={`Filter ${caption}`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="table-scroll">
        <Table className="module-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  aria-sort={
                    sort?.key === c.key
                      ? sort.descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                  style={{
                    resize: "horizontal",
                    overflow: "auto",
                    minWidth: 100,
                  }}
                >
                  <Button
                    onClick={() =>
                      setSort({
                        key: c.key,
                        descending:
                          sort?.key === c.key ? !sort.descending : false,
                      })
                    }
                  >
                    {c.label}
                  </Button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.render ? c.render(row) : String(row[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
export function VirtualList<T>({
  items,
  height = 400,
  rowHeight = 40,
  renderItem,
  label,
}: {
  items: readonly T[];
  height?: number;
  rowHeight?: number;
  renderItem: (item: T, index: number) => ReactNode;
  label: string;
}) {
  const [top, setTop] = useState(0);
  const start = Math.max(0, Math.floor(top / rowHeight) - 5),
    end = Math.min(items.length, Math.ceil((top + height) / rowHeight) + 5);
  return (
    <div
      role="list"
      aria-label={label}
      style={{ height, overflow: "auto" }}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: items.length * rowHeight, position: "relative" }}>
        {items.slice(start, end).map((item, i) => (
          <div
            key={start + i}
            role="listitem"
            className="list-item"
            aria-setsize={items.length}
            aria-posinset={start + i + 1}
            style={{
              position: "absolute",
              top: (start + i) * rowHeight,
              height: rowHeight,
              width: "100%",
            }}
          >
            {renderItem(item, start + i)}
          </div>
        ))}
      </div>
    </div>
  );
}
export interface TreeNode {
  id: string;
  label: string;
  children?: TreeNode[];
}
export function TreeView({
  nodes,
  onSelect,
  label,
}: {
  nodes: TreeNode[];
  onSelect: (id: string) => void;
  label: string;
}) {
  return (
    <ul aria-label={label}>
      {nodes.map((node) => (
        <li key={node.id}>
          {node.children?.length ? (
            <details>
              <summary>{node.label}</summary>
              <Button onClick={() => onSelect(node.id)}>
                Select {node.label}
              </Button>
              <TreeView
                nodes={node.children}
                onSelect={onSelect}
                label={node.label}
              />
            </details>
          ) : (
            <Button onClick={() => onSelect(node.id)}>{node.label}</Button>
          )}
        </li>
      ))}
    </ul>
  );
}
export function SplitPane({
  first,
  second,
  label,
}: {
  first: ReactNode;
  second: ReactNode;
  label: string;
}) {
  const [width, setWidth] = useState(50);
  return (
    <section aria-label={label}>
      <label>
        Panel width
        <input
          type="range"
          min={20}
          max={80}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
        />
      </label>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(0,${width}fr) minmax(0,${100 - width}fr)`,
          gap: 16,
        }}
      >
        <div>{first}</div>
        <div>{second}</div>
      </div>
    </section>
  );
}
export function FileDropzone({
  onFiles,
  label,
  accept,
}: {
  onFiles: (files: File[]) => void;
  label: string;
  accept?: string;
}) {
  return (
    <label
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {label}
      <input
        type="file"
        multiple
        accept={accept}
        onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
      />
    </label>
  );
}
export function ProgressBar({
  value,
  max = 100,
  label,
}: {
  value: number;
  max?: number;
  label: string;
}) {
  return (
    <label>
      {label}
      <progress aria-label={label} value={value} max={max} />
    </label>
  );
}
