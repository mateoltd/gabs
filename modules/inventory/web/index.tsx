import type { ModuleDefinition } from "@suite/module-sdk";
import scopedDefinition from "../releases/2.0.0/module";
import moduleDefinition from "../releases/1.2.0/module";
import { useToast } from "@suite/ui-web";
import {
  Checkbox,
  Input,
  NumberInput,
  Select,
  SelectOption,
  Textarea,
} from "@suite/ui-web";
import { useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Plus,
  ArrowDownToLine,
  SlidersHorizontal,
  Package,
  ArrowUpRight,
  History,
} from "@suite/ui-web/icons";
import {
  Button,
  Modal,
  Field,
  ErrorMessage,
  PageHeading,
  SearchField,
  Badge,
  Money,
  Empty,
  Loading,
  Pagination,
  ResultsMotion,
  ContentSkeleton,
  SegmentedControl,
  Status,
  ListPage,
  ListToolbar,
  ListTable,
  SummaryStrip,
  RecordIdentity,
} from "@suite/ui-web";
import { type FeatureProps, canUse } from "@suite/platform";
import type { Product } from "@suite/contracts";
export default function Inventory({
  client,
  scope,
  bootstrap,
  online,
  snapshot,
  onError,
  definition,
}: FeatureProps & { definition: ModuleDefinition }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const lowStock = searchParams.get("stock") === "low";
  const urlSearch = searchParams.get("search") ?? "";
  const [search, setSearch] = useState(searchParams.get("search") ?? ""),
    [cursors, setCursors] = useState<(string | undefined)[]>([undefined]),
    [view, setView] = useState<"products" | "history">("products");
  useEffect(() => {
    setSearch(urlSearch);
    setCursors([undefined]);
  }, [urlSearch, definition.version]);
  const [editor, setEditor] = useState<Product | "new" | null>(null),
    [stock, setStock] = useState<Product | null>(null),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const [sku, setSku] = useState(""),
    [name, setName] = useState(""),
    [price, setPrice] = useState(""),
    [active, setActive] = useState(true),
    [kind, setKind] = useState<"receipt" | "adjustment" | "count">("receipt"),
    [quantity, setQuantity] = useState(""),
    [reason, setReason] = useState("");
  const [attempt, setAttempt] = useState<{
    key: string;
    definition: ModuleDefinition;
  }>();
  const apiFor = (definition: ModuleDefinition) => ({
    api: client.module(
      { ...moduleDefinition, version: definition.version },
      scope.workspaceId,
    ),
    scoped:
      (definition.storage?.version ?? 1) >= 2
        ? client.module(
            { ...scopedDefinition, version: definition.version },
            scope.workspaceId,
          )
        : undefined,
  });
  const qc = useQueryClient();
  const cursor = cursors.at(-1);
  const allowed =
    canUse(bootstrap, "inventory", "inventory.read") ||
    canUse(bootstrap, "inventory", "inventory.availability.read");
  const query = useQuery({
    queryKey: [
      scope.userId,
      scope.workspaceId,
      "products",
      search,
      cursor,
      lowStock,
    ],
    queryFn: () =>
      client.request({
        operation: "products",
        params: { workspaceId: scope.workspaceId },
        query: { search, cursor, stock: lowStock ? "low" : undefined },
      }),
    placeholderData: keepPreviousData,
    enabled: online && allowed && view === "products",
  });
  const overview = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "overview"],
    queryFn: () =>
      client.request({
        operation: "overview",
        params: { workspaceId: scope.workspaceId },
      }),
    enabled: online && allowed,
  });
  const stockSummary = online ? overview.data?.inventory : undefined;
  function filterStock(value: boolean) {
    setView("products");
    setCursors([undefined]);
    const next = new URLSearchParams(searchParams);
    if (value) next.set("stock", "low");
    else next.delete("stock");
    setSearchParams(next);
  }
  const history = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "movements", cursor],
    placeholderData: keepPreviousData,
    queryFn: () =>
      client.request({
        operation: "movements",
        params: { workspaceId: scope.workspaceId },
        query: { cursor },
      }),
    enabled:
      online &&
      view === "history" &&
      canUse(bootstrap, "inventory", "inventory.read"),
  });
  const items =
    query.data?.items ??
    (!online
      ? snapshot?.products.filter(
          (p) =>
            `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase()) &&
            (!lowStock || (p.active && p.available <= 10)),
        )
      : []) ??
    [];
  const invalidate = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === scope.userId && q.queryKey[1] === scope.workspaceId,
    });
  function openEdit(product: Product | "new") {
    setError(undefined);
    setAttempt(undefined);
    setEditor(product);
    setSku(product === "new" ? "" : product.sku);
    setName(product === "new" ? "" : product.name);
    setPrice(product === "new" ? "" : String(product.priceMinor / 100));
    setActive(product === "new" ? true : product.active);
  }
  async function saveProduct(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const current = attempt ?? { key: crypto.randomUUID(), definition };
    const { key } = current;
    const { api, scoped } = apiFor(current.definition);
    setAttempt(current);
    try {
      const priceMinor = Math.round(Number(price) * 100);
      if (!Number.isFinite(priceMinor) || priceMinor < 0)
        throw Error("Enter a valid price.");
      if (editor === "new")
        await api.call("create-product", { sku, name, priceMinor }, key);
      else if (editor && scoped)
        await scoped.call(
          "edit-product",
          {
            id: editor.id,
            version: editor.version,
            sku,
            name,
            priceMinor,
            active,
          },
          key,
        );
      else if (editor)
        await client.request({
          operation: "productEdit",
          params: { workspaceId: scope.workspaceId, id: editor.id },
          body: { sku, name, priceMinor, active },
          version: editor.version,
        });
      setEditor(null);
      toast.add({ title: "Product saved", type: "success" });
      await invalidate();
    } catch (e) {
      setError(e);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  async function saveStock(event: React.FormEvent) {
    event.preventDefault();
    if (!stock) return;
    setBusy(true);
    setError(undefined);
    const current = attempt ?? { key: crypto.randomUUID(), definition };
    const { key } = current;
    const { api, scoped } = apiFor(current.definition);
    setAttempt(current);
    try {
      if (kind === "count") {
        if (stock.stockVersion === undefined)
          throw new Error("Reload inventory before recording a count.");
        await api.call(
          "count",
          {
            id: stock.id,
            stockVersion: stock.stockVersion,
            counted: Number(quantity),
            reason,
          },
          key,
        );
      } else if (scoped)
        await scoped.call(
          kind === "receipt" ? "receipt" : "adjustment",
          { id: stock.id, quantity: Number(quantity), reason },
          key,
        );
      else
        await api.call(
          "stock",
          { id: stock.id, kind, quantity: Number(quantity), reason },
          key,
        );
      setStock(null);
      toast.add({ title: "Stock updated", type: "success" });
      await invalidate();
    } catch (e) {
      setError(e);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  if (!allowed)
    return (
      <Empty
        title="Inventory access required"
        description="Ask an administrator for a role and module access, or request access in Modules."
      />
    );
  return (
    <ListPage className="inventory-page">
      <PageHeading
        title="Inventory"
        description="Stock on hand, what’s committed, and what needs replenishing."
        actions={
          <>
            {online &&
              canUse(bootstrap, "inventory", "inventory.products.manage") && (
                <Button variant="primary" onClick={() => openEdit("new")}>
                  <Plus size={17} />
                  Add product
                </Button>
              )}
          </>
        }
      />
      <div className="list-tabs">
        <SegmentedControl
          panelId="inventory-results"
          label="Inventory view"
          value={view}
          onChange={(value) => {
            setView(value as "products" | "history");
            setCursors([undefined]);
          }}
          options={[
            { value: "products", label: "All products" },
            ...(canUse(bootstrap, "inventory", "inventory.read")
              ? [{ value: "history", label: "Movement history" }]
              : []),
          ]}
        />
      </div>
      {stockSummary && (
        <SummaryStrip
          className="inventory-summary"
          aria-label="Workspace stock summary"
        >
          <div>
            <h2>Active products</h2>
            <strong className="summary-value">
              {stockSummary.products.toLocaleString()}
            </strong>
            <span className="summary-caption">Across this workspace</span>
          </div>
          <div>
            <h2>Need restocking</h2>
            <button
              className="summary-link"
              aria-label="View low-stock products"
              onClick={() => {
                setSearch("");
                const next = new URLSearchParams(searchParams);
                next.delete("search");
                next.set("stock", "low");
                setSearchParams(next);
                setView("products");
                setCursors([undefined]);
              }}
            >
              <strong className="summary-value">
                {stockSummary.lowStock.toLocaleString()}
              </strong>
              <ArrowUpRight size={16} />
            </button>
            <div
              className="summary-track"
              role="img"
              aria-label={`${stockSummary.lowStock} of ${stockSummary.products} active products have 10 or fewer available units`}
            >
              <span
                style={{
                  width: `${stockSummary.products ? (stockSummary.lowStock / stockSummary.products) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="summary-caption">10 or fewer units available</span>
          </div>
          <div>
            <h2>Available units</h2>
            <strong className="summary-value">
              {stockSummary.available.toLocaleString()}
            </strong>
            <span className="summary-caption">Reserved stock excluded</span>
          </div>
        </SummaryStrip>
      )}
      <ListToolbar>
        {view === "products" ? (
          <>
            <SearchField
              value={search}
              onChange={(value) => {
                setSearch(value);
                setCursors([undefined]);
              }}
              placeholder="Search products or SKU"
            />
            <label className="check-row">
              <Checkbox checked={lowStock} onCheckedChange={filterStock} />
              Low stock only{" "}
              <span className="small muted">10 or fewer available</span>
            </label>
          </>
        ) : (
          <span className="list-toolbar-note">
            Receipts, adjustments, reservations, and fulfillment
          </span>
        )}
      </ListToolbar>
      <ErrorMessage error={query.error ?? history.error} />
      <ResultsMotion
        motionKey={`${view}:${search}:${lowStock}:${cursor ?? "first"}`}
        pending={
          online &&
          (view === "products"
            ? query.isPlaceholderData || query.isLoading
            : history.isPlaceholderData || history.isLoading)
        }
        id="inventory-results"
        role="tabpanel"
        aria-label="Inventory"
        tabIndex={0}
      >
        {view === "products" ? (
          query.isLoading && online ? (
            <ContentSkeleton label="Loading inventory" />
          ) : items.length ? (
            <>
              <ListTable className="inventory-table" aria-label="Products">
                <thead>
                  <tr>
                    <th>Product</th>
                    {bootstrap.permissions.includes("inventory.read") && (
                      <>
                        <th className="numeric">On hand</th>
                        <th className="numeric">Reserved</th>
                      </>
                    )}
                    <th className="numeric">Available</th>
                    <th className="numeric">Unit price</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <RecordIdentity
                          symbol={<Package size={17} />}
                          primary={p.name}
                          secondary={<span className="mono">{p.sku}</span>}
                        />
                      </td>
                      {bootstrap.permissions.includes("inventory.read") && (
                        <>
                          <td className="numeric">{p.onHand ?? "N/A"}</td>
                          <td className="numeric muted">
                            {p.reserved ?? "N/A"}
                          </td>
                        </>
                      )}
                      <td className="numeric">
                        <strong>{p.available}</strong>
                      </td>
                      <td className="numeric">
                        <Money
                          minor={p.priceMinor}
                          currency={bootstrap.workspace.currency}
                        />
                      </td>
                      <td>
                        <Status
                          status={
                            !p.active
                              ? "archived"
                              : p.available <= 0
                                ? "out-of-stock"
                                : p.available <= 10
                                  ? "low-stock"
                                  : "in-stock"
                          }
                          label={
                            !p.active
                              ? "Archived"
                              : p.available <= 0
                                ? "Out of stock"
                                : p.available <= 10
                                  ? "Low stock"
                                  : "In stock"
                          }
                        />
                      </td>
                      <td className="row-actions">
                        <div className="actions">
                          {online &&
                            (canUse(
                              bootstrap,
                              "inventory",
                              "inventory.receive",
                            ) ||
                              canUse(
                                bootstrap,
                                "inventory",
                                "inventory.adjust",
                              )) && (
                              <Button
                                variant="ghost"
                                aria-label={`Change stock for ${p.name}`}
                                onClick={() => {
                                  setStock(p);
                                  setKind(
                                    canUse(
                                      bootstrap,
                                      "inventory",
                                      "inventory.receive",
                                    )
                                      ? "receipt"
                                      : "adjustment",
                                  );
                                  setQuantity("");
                                  setReason("");
                                  setAttempt(undefined);
                                  setError(undefined);
                                }}
                              >
                                <ArrowDownToLine size={16} />
                              </Button>
                            )}
                          {online &&
                            canUse(
                              bootstrap,
                              "inventory",
                              "inventory.products.manage",
                            ) && (
                              <Button
                                variant="ghost"
                                aria-label={`Edit ${p.name}`}
                                onClick={() => openEdit(p)}
                              >
                                <ArrowUpRight size={16} />
                              </Button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ListTable>
              <div className="list-footer">
                <span>
                  {items.length} {items.length === 1 ? "product" : "products"}{" "}
                  on this page{!online && " (cached)"}
                </span>
                <Pagination
                  pending={query.isPlaceholderData || query.isFetching}
                  next={query.data?.nextCursor}
                  hasPrevious={cursors.length > 1}
                  onNext={() =>
                    setCursors([
                      ...cursors,
                      query.data?.nextCursor ?? undefined,
                    ])
                  }
                  onPrevious={() => setCursors(cursors.slice(0, -1))}
                />
              </div>
            </>
          ) : (
            <Empty
              title="No products found"
              description="Add your first product or try another search."
            />
          )
        ) : !online ? (
          <Empty
            title="Connect to view stock history"
            description="The movement ledger is available online."
          />
        ) : history.isLoading ? (
          <ContentSkeleton label="Loading inventory" />
        ) : !history.data?.items.length ? (
          <Empty
            title={
              cursors.length > 1
                ? "No more movements"
                : "No stock movements yet"
            }
            description="Receipts, counts, reservations, and fulfillment will appear here."
            action={
              cursors.length > 1 && (
                <Button onClick={() => setCursors(cursors.slice(0, -1))}>
                  Previous
                </Button>
              )
            }
          />
        ) : (
          <>
            <ListTable
              className="inventory-history-table"
              aria-label="Stock movements"
            >
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Movement</th>
                  <th className="numeric">On hand change</th>
                  <th className="numeric">Reserved change</th>
                  <th>Reason</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {history.data?.items.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.sku}</td>
                    <td>{m.kind.charAt(0).toUpperCase() + m.kind.slice(1)}</td>
                    <td className="numeric">
                      {m.onHandDelta > 0 ? "+" : ""}
                      {m.onHandDelta}
                    </td>
                    <td className="numeric">
                      {m.reservedDelta > 0 ? "+" : ""}
                      {m.reservedDelta}
                    </td>
                    <td>{m.reason}</td>
                    <td className="small muted">
                      {new Date(m.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ListTable>
            <div className="list-footer">
              <span>{history.data.items.length} movements on this page</span>
              <Pagination
                pending={history.isPlaceholderData || history.isFetching}
                next={history.data?.nextCursor}
                hasPrevious={cursors.length > 1}
                onNext={() =>
                  setCursors([
                    ...cursors,
                    history.data?.nextCursor ?? undefined,
                  ])
                }
                onPrevious={() => setCursors(cursors.slice(0, -1))}
              />
            </div>
          </>
        )}
      </ResultsMotion>
      <Modal
        open={editor !== null}
        onOpenChange={(open) => !busy && !open && setEditor(null)}
        title={editor === "new" ? "Add a product" : "Edit product"}
        description="Product changes apply to future drafts. Existing order snapshots stay unchanged."
      >
        <form onSubmit={saveProduct} className="form-stack">
          <div className="form-grid">
            <Field label="Product name">
              <Input
                required
                maxLength={200}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setAttempt(undefined);
                }}
                autoFocus
              />
            </Field>
            <Field label="SKU">
              <Input
                required
                maxLength={80}
                value={sku}
                onChange={(e) => {
                  setSku(e.target.value);
                  setAttempt(undefined);
                }}
              />
            </Field>
          </div>
          <Field label={`Unit price (${bootstrap.workspace.currency})`}>
            <NumberInput
              min={0}
              max={1000000}
              step="0.01"
              required
              value={price}
              onValueChange={(e) => {
                setPrice(e);
                setAttempt(undefined);
              }}
            />
          </Field>
          {editor !== "new" && (
            <label className="check-row">
              <Checkbox
                checked={active}
                onCheckedChange={(e) => {
                  setActive(e);
                  setAttempt(undefined);
                }}
              />
              Active product
            </label>
          )}
          <ErrorMessage error={error} />
          <div className="form-footer">
            <Button
              type="button"
              onClick={() => setEditor(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save product"}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!stock}
        onOpenChange={(open) => !busy && !open && setStock(null)}
        title="Update stock"
        description={
          stock ? `${stock.name}: ${stock.available} units available.` : ""
        }
      >
        <form onSubmit={saveStock} className="form-stack">
          <div className="form-grid">
            <Field label="Movement type">
              <Select
                value={kind}
                onValueChange={(e) => {
                  setKind(e as typeof kind);
                  setAttempt(undefined);
                }}
              >
                {canUse(bootstrap, "inventory", "inventory.receive") && (
                  <SelectOption value="receipt">Receive stock</SelectOption>
                )}
                {canUse(bootstrap, "inventory", "inventory.adjust") && (
                  <>
                    <SelectOption value="adjustment">Adjust stock</SelectOption>
                    {stock?.stockVersion !== undefined &&
                      definition.operations.count && (
                        <SelectOption value="count">
                          Record physical count
                        </SelectOption>
                      )}
                  </>
                )}
              </Select>
            </Field>
            <Field
              label={
                kind === "count"
                  ? "Units physically counted"
                  : kind === "receipt"
                    ? "Units received"
                    : "Change in units"
              }
              hint={
                kind === "adjustment"
                  ? "Use a negative number to remove units."
                  : kind === "count"
                    ? `Count all units on hand, including reserved units. Current on-hand quantity: ${stock?.onHand ?? "unknown"}.`
                    : undefined
              }
            >
              <NumberInput
                required
                step="1"
                min={kind === "count" ? 0 : kind === "receipt" ? 1 : undefined}
                value={quantity}
                onValueChange={(e) => {
                  setQuantity(e);
                  setAttempt(undefined);
                }}
              />
            </Field>
          </div>
          {kind === "count" &&
            stock?.onHand !== undefined &&
            quantity !== "" && (
              <p role="status">
                Variance: {Number(quantity) - stock.onHand} units. The server
                checks for intervening stock changes before accepting this
                count.
              </p>
            )}
          <Field label="Reason">
            <Textarea
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setAttempt(undefined);
              }}
            />
          </Field>
          <ErrorMessage error={error} />
          <div className="form-footer">
            <Button
              onClick={() => setStock(null)}
              type="button"
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save stock change"}
            </Button>
          </div>
        </form>
      </Modal>
    </ListPage>
  );
}
