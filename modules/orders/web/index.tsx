import type { ModuleDefinition } from "@suite/module-sdk";
import { Table } from "@suite/ui-web";
import moduleDefinition from "../releases/1.1.0/module";
import { useToast, Tooltip } from "@suite/ui-web";
import { Input, Select, SelectOption, NumberInput } from "@suite/ui-web";
import { useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Plus,
  Download,
  ArrowUpRight,
  Check,
  Truck,
  Upload,
  Trash2,
  FileText,
  Package,
  ChevronDown,
} from "@suite/ui-web/icons";
import {
  Button,
  Checkbox,
  ActionMenu,
  Modal,
  DetailPanel,
  Field,
  ErrorMessage,
  PageHeading,
  SearchField,
  Status,
  Money,
  Empty,
  Loading,
  Badge,
  Pagination,
  ResultsMotion,
  ContentSkeleton,
  SegmentedControl,
} from "@suite/ui-web";
import { ApiError } from "@suite/client/api";
import {
  type FeatureProps,
  type LocalDraft,
  type PendingCommand,
  canUse as canUseWithCatalog,
} from "@suite/client";
import type { DraftInput, Order } from "@suite/contracts";
function isOrderConflict(error: ApiError) {
  const detail = error.detail as
    { moduleId?: string; error?: { code?: string } } | undefined;
  return (
    error.status === 412 ||
    (error.code === "MODULE_BUSINESS_ERROR" &&
      detail?.moduleId === "orders" &&
      detail.error?.code === "VERSION_CONFLICT")
  );
}
type OrderAction = "confirm" | "fulfill" | "cancel";
const orderOperations = {
  confirm: "orderConfirm",
  fulfill: "orderFulfill",
  cancel: "orderCancel",
} as const;
const actionLabels = {
  confirm: "Confirm",
  fulfill: "Fulfill",
  cancel: "Cancel",
};
const actionEffects = {
  confirm: "Stock will be reserved for these draft orders.",
  fulfill:
    "Reserved stock will be deducted and these orders will be marked fulfilled.",
  cancel:
    "These orders will be cancelled and any reserved stock released. This cannot be undone.",
};

export default function Orders(
  props: FeatureProps & { definition: ModuleDefinition },
) {
  const {
    client,
    scope,
    bootstrap,
    online,
    platform,
    snapshot,
    offlineEnabled,
    onError,
    moduleCatalog,
  } = props;
  const canUse = (
    current: FeatureProps["bootstrap"],
    moduleId: string,
    permission: string,
  ) => canUseWithCatalog(current, moduleId, permission, moduleCatalog);
  // The host verifies the installed package; this view consumes its stable command contract.
  const apiFor = (version = props.definition.version) =>
    client.module({ ...moduleDefinition, version }, scope.workspaceId);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "all";
  const filter = [
    "all",
    "draft",
    "confirmed",
    "fulfilled",
    "cancelled",
    "local",
  ].includes(status)
    ? status
    : "all";
  const setFilter = (value: string) => {
    setCursors([undefined]);
    setSearchParams(value === "all" ? {} : { status: value });
  };
  const [search, setSearch] = useState(""),
    [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors.at(-1);
  useEffect(() => {
    setCursors([undefined]);
  }, [props.definition.version]);
  const [selected, setSelected] = useState<Order | null>(null),
    [editor, setEditor] = useState<LocalDraft | null>(null),
    [drafts, setDrafts] = useState<LocalDraft[]>([]),
    [pending, setPending] = useState<PendingCommand[]>([]);
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [discardDraft, setDiscardDraft] = useState<LocalDraft | null>(null),
    [discardBusy, setDiscardBusy] = useState(false),
    [discardError, setDiscardError] = useState<unknown>(),
    [exportsOpen, setExportsOpen] = useState(false),
    [conflictVersion, setConflictVersion] = useState<Order | null>(null);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [bulkReview, setBulkReview] = useState<{
    action: OrderAction;
    orders: Order[];
    skipped: number;
  } | null>(null);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkResult, setBulkResult] = useState<{
    succeeded: number;
    failures: { number: number; error: unknown }[];
  } | null>(null);
  // A selection always belongs to one visible page, including browser navigation.
  useEffect(() => {
    setCheckedIds([]);
  }, [filter, search, cursor, scope.workspaceId, scope.userId, online]);
  const qc = useQueryClient(),
    params = { workspaceId: scope.workspaceId };
  const allowed = canUse(bootstrap, "orders", "orders.read");
  const query = useQuery({
    queryKey: [
      scope.userId,
      scope.workspaceId,
      "orders",
      search,
      cursor,
      filter,
    ],
    queryFn: () =>
      client.request({
        operation: "orders",
        params,
        query: {
          search,
          cursor,
          status: filter === "all" || filter === "local" ? undefined : filter,
        },
      }),
    placeholderData: keepPreviousData,
    enabled: online && allowed && filter !== "local",
  });
  const totals = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "overview"],
    queryFn: () => client.request({ operation: "overview", params }),
    enabled: online && allowed,
  });
  const orderDetail = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "order-detail", selected?.id],
    queryFn: () =>
      client.request({
        operation: "orderGet",
        params: { ...params, id: selected!.id },
      }),
    enabled: online && allowed && !!selected,
  });
  useEffect(() => {
    const fresh = orderDetail.data;
    if (fresh)
      setSelected((previous) =>
        previous?.id === fresh.id && fresh.version >= previous.version
          ? fresh
          : previous,
      );
  }, [orderDetail.data]);
  const productsQuery = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "products", "", undefined],
    queryFn: () =>
      client.request({ operation: "products", params, query: { search: "" } }),
    enabled: online && allowed,
  });
  const [productSearch, setProductSearch] = useState("");
  const matchingProducts = useQuery({
    queryKey: [
      scope.userId,
      scope.workspaceId,
      "products",
      productSearch,
      undefined,
    ],
    queryFn: () =>
      client.request({
        operation: "products",
        params,
        query: { search: productSearch },
      }),
    enabled: online && allowed && !!editor && !!productSearch,
  });
  const products = [
    ...new Map(
      [
        ...(productsQuery.data?.items ?? snapshot?.products ?? []),
        ...(matchingProducts.data?.items ?? []),
      ].map((p) => [p.id, p]),
    ).values(),
  ];
  const exportsQuery = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "exports"],
    queryFn: () => client.request({ operation: "exports", params }),
    enabled:
      online && exportsOpen && canUse(bootstrap, "orders", "orders.export"),
    refetchInterval: exportsOpen ? 5000 : false,
  });
  useEffect(() => {
    let active = true;
    Promise.all([
      platform.load<LocalDraft[]>(scope, "drafts"),
      platform.load<PendingCommand[]>(scope, "pending"),
    ])
      .then(([d, p]) => {
        if (active) {
          setDrafts(d ?? []);
          setPending(p ?? []);
        }
      })
      .catch(setError);
    return () => {
      active = false;
    };
  }, [scope.userId, scope.workspaceId, platform]);
  const invalidate = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === scope.userId && q.queryKey[1] === scope.workspaceId,
    });
  async function updateDraft(draft: LocalDraft, remove = false) {
    const update = async () => {
      const stored = (await platform.load<LocalDraft[]>(scope, "drafts")) ?? [];
      const next = remove
        ? stored.filter((d) => d.id !== draft.id)
        : [...stored.filter((d) => d.id !== draft.id), draft];
      await platform.save(scope, "drafts", next);
      setDrafts(next);
    };
    if (platform.kind === "web" && navigator.locks)
      await navigator.locks.request(
        `drafts:${scope.userId}:${scope.workspaceId}`,
        update,
      );
    else await update();
  }
  function newDraft() {
    setError(undefined);
    setConflictVersion(null);
    setEditor({
      id: crypto.randomUUID(),
      moduleVersion: props.definition.version,
      uploadKey: crypto.randomUUID(),
      input: {
        customerName: "",
        lines: [
          {
            productId: products[0]?.id ?? "",
            quantity: 1,
            priceMinor: products[0]?.priceMinor ?? 0,
          },
        ],
      },
      updatedAt: Date.now(),
      state: "local",
    });
  }
  function editRemote(order: Order) {
    setError(undefined);
    setConflictVersion(null);
    setSelected(null);
    setEditor({
      id: crypto.randomUUID(),
      remoteId: order.id,
      baseVersion: order.version,
      moduleVersion: props.definition.version,
      uploadKey: crypto.randomUUID(),
      input: {
        customerName: order.customerName,
        lines: order.lines!.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          priceMinor: l.priceMinor,
        })),
      },
      updatedAt: Date.now(),
      state: "local",
    });
  }
  function changeInput(input: DraftInput) {
    if (editor)
      setEditor({
        ...editor,
        input,
        uploadKey: crypto.randomUUID(),
        moduleVersion: props.definition.version,
        updatedAt: Date.now(),
        state: "local",
      });
  }
  async function saveLocal() {
    if (!editor) return;
    setBusy(true);
    setError(undefined);
    try {
      if (!offlineEnabled)
        throw Error(
          "Enable offline storage on this device before saving local drafts.",
        );
      await updateDraft({ ...editor, state: "local", updatedAt: Date.now() });
      setEditor(null);
      setMessage("Saved on this device");
      toast.add({ title: "Draft saved on this device", type: "success" });
      setFilter("local");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!editor) return;
    setBusy(true);
    setError(undefined);
    const attempt = {
      ...editor,
      moduleVersion: editor.moduleVersion ?? "1.1.0",
      state: "uploading" as const,
    };
    const api = apiFor(attempt.moduleVersion);
    setEditor(attempt);
    try {
      if (offlineEnabled) await updateDraft(attempt);
      const result = editor.remoteId
        ? await api.call(
            "edit",
            {
              ...editor.input,
              id: editor.remoteId,
              version: editor.baseVersion!,
            },
            editor.uploadKey,
          )
        : await api.call("draft", editor.input, editor.uploadKey);
      if (offlineEnabled || drafts.some((d) => d.id === editor.id))
        await updateDraft(attempt, true);
      setEditor(null);
      setSelected(result);
      setMessage("Saved to server");
      toast.add({ title: "Order draft saved", type: "success" });
      await invalidate();
    } catch (e) {
      setError(e);
      onError(e);
      if (e instanceof ApiError) {
        const next = {
          ...attempt,
          state: isOrderConflict(e)
            ? ("conflict" as const)
            : ("local" as const),
        };
        setEditor(next);
        if (offlineEnabled) await updateDraft(next).catch(setError);
        if (isOrderConflict(e) && editor.remoteId) {
          const latest = await client.request({
            operation: "orderGet",
            params: { ...params, id: editor.remoteId },
          });
          setConflictVersion(latest);
        }
      }
    } finally {
      setBusy(false);
    }
  }
  // Single and bulk actions share version checks and durable idempotency keys.
  async function executeCommand(order: Order, action: OrderAction) {
    const operation = orderOperations[action];
    const current =
      (await platform.load<PendingCommand[]>(scope, "pending")) ?? [];
    const existing = current.find((p) => p.orderId === order.id);
    if (existing && existing.operation !== operation)
      throw Error("Resolve the pending operation before starting another.");
    const attempt = existing ?? {
      moduleVersion: props.definition.version,
      operation,
      orderId: order.id,
      version: order.version,
      key: crypto.randomUUID(),
    };
    const next = [...current.filter((p) => p.orderId !== order.id), attempt];
    await platform.save(scope, "pending", next);
    setPending(next);
    try {
      const action = {
        orderConfirm: "confirm",
        orderFulfill: "fulfill",
        orderCancel: "cancel",
      } as const;
      const result = await apiFor(attempt.moduleVersion ?? "1.1.0").call(
        action[operation],
        { id: order.id, version: attempt.version },
        attempt.key,
      );
      const remaining = next.filter((p) => p.orderId !== order.id);
      await platform.save(scope, "pending", remaining);
      setPending(remaining);
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) {
        const remaining = next.filter((p) => p.orderId !== order.id);
        await platform.save(scope, "pending", remaining);
        setPending(remaining);
      }
      throw e;
    }
  }
  async function command(order: Order, action: OrderAction) {
    setBusy(true);
    setError(undefined);
    try {
      setSelected(await executeCommand(order, action));
      setMessage("Order saved to server");
      toast.add({ title: "Order changes saved", type: "success" });
    } catch (e) {
      setError(e);
      onError(e);
    } finally {
      await invalidate();
      setBusy(false);
    }
  }
  async function runBulk() {
    if (!bulkReview || busy || !online) return;
    setBusy(true);
    setBulkProgress(0);
    const failures: { number: number; error: unknown }[] = [];
    const succeeded: string[] = [];
    try {
      // Sequential requests keep stock contention low and preserve the retry queue.
      for (const order of bulkReview.orders) {
        try {
          const result = await executeCommand(order, bulkReview.action);
          succeeded.push(order.id);
          setSelected((current) =>
            current?.id === result.id ? result : current,
          );
        } catch (e) {
          failures.push({ number: order.number, error: e });
          onError(e);
        }
        setBulkProgress(succeeded.length + failures.length);
      }
      setCheckedIds((ids) => ids.filter((id) => !succeeded.includes(id)));
      setBulkResult({ succeeded: succeeded.length, failures });
      setMessage(
        `${succeeded.length} of ${bulkReview.orders.length} orders updated.`,
      );
      if (!failures.length)
        toast.add({
          title: `${succeeded.length} orders updated`,
          type: "success",
        });
      await invalidate();
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const id = searchParams.get("order");
    if (!id || !online || !allowed) return;
    let active = true;
    void client
      .request({ operation: "orderGet", params: { ...params, id } })
      .then((order) => {
        if (active) {
          setSelected(order);
          setSearchParams({}, { replace: true });
        }
      })
      .catch((e) => {
        if (active) {
          setError(e);
          setSearchParams({}, { replace: true });
        }
      });
    return () => {
      active = false;
    };
  }, [searchParams, online, allowed]);
  useEffect(() => {
    if (searchParams.get("new") !== "1" || (!productsQuery.data && online))
      return;
    if (
      canUse(bootstrap, "orders", "orders.create") &&
      (online || offlineEnabled)
    )
      newDraft();
    setSearchParams({}, { replace: true });
  }, [searchParams, productsQuery.data, online]);
  const rows = (
    query.data?.items ??
    (!online ? snapshot?.orders : []) ??
    []
  ).filter(
    (o) =>
      (filter === "all" || filter === "local" || o.status === filter) &&
      (!search || o.customerName.toLowerCase().includes(search.toLowerCase())),
  );

  const checkedOrders = rows.filter((order) => checkedIds.includes(order.id));
  const canBulk = (["confirm", "fulfill", "cancel"] as const).some((action) =>
    canUse(bootstrap, "orders", `orders.${action}`),
  );
  function eligibleOrders(action: OrderAction) {
    return checkedOrders.filter((order) => {
      const attempt = pending.find((p) => p.orderId === order.id);
      if (attempt) return attempt.operation === orderOperations[action];
      return action === "confirm"
        ? order.status === "draft"
        : action === "fulfill"
          ? order.status === "confirmed"
          : order.status === "draft" || order.status === "confirmed";
    });
  }
  const selectionDisabled =
    busy || !online || query.isPlaceholderData || query.isLoading;

  if (!allowed)
    return (
      <Empty
        title="Orders access required"
        description="Ask an administrator for a role and module access, or request access in Modules."
      />
    );
  return (
    <div className="orders-workbench">
      <div className="orders-list">
        <PageHeading
          title="Orders"
          description="Create drafts, reserve stock, and manage fulfillment."
          actions={
            <>
              {canUse(bootstrap, "orders", "orders.create") &&
                (online || offlineEnabled) && (
                  <Button variant="primary" onClick={newDraft}>
                    <Plus size={17} />
                    New order
                  </Button>
                )}
            </>
          }
        />
        <div className="orders-tabs">
          <SegmentedControl
            panelId="order-results"
            label="Order status"
            value={filter}
            onChange={setFilter}
            options={[
              "all",
              "draft",
              "confirmed",
              "fulfilled",
              "cancelled",
            ].map((status) => {
              const summary = online ? totals.data?.orders : undefined;
              const count = summary
                ? status === "all"
                  ? summary.draft +
                    summary.confirmed +
                    summary.fulfilled +
                    summary.cancelled
                  : summary[
                      status as
                        "draft" | "confirmed" | "fulfilled" | "cancelled"
                    ]
                : undefined;
              return {
                value: status,
                label: (
                  <>
                    {status === "all"
                      ? "All orders"
                      : status.charAt(0).toUpperCase() + status.slice(1)}
                    {count !== undefined && (
                      <span className="tab-count" aria-hidden="true">
                        {count}
                      </span>
                    )}
                  </>
                ),
              };
            })}
          />
        </div>
        {online && totals.data?.orders?.fulfilledDaily && (
          <FulfillmentSummary
            days={totals.data.orders.fulfilledDaily}
            confirmed={totals.data.orders.confirmed}
            draft={totals.data.orders.draft}
            onFilter={(value) => {
              setSearch("");
              setFilter(value);
            }}
          />
        )}
        <div className="orders-filters">
          <SearchField
            value={search}
            onChange={(value) => {
              setSearch(value);
              setCursors([undefined]);
            }}
            placeholder="Search customers"
          />
          {checkedOrders.length === 0 &&
            (offlineEnabled || drafts.length > 0) && (
              <Button
                className="local-drafts-link"
                aria-pressed={filter === "local"}
                onClick={() => setFilter("local")}
              >
                <FileText size={15} />
                On this device ({drafts.length})
              </Button>
            )}
          {checkedOrders.length === 0 &&
            online &&
            canUse(bootstrap, "orders", "orders.export") && (
              <Button
                className="icon-button"
                aria-label="Export orders"
                title="Export orders"
                onClick={() => setExportsOpen(true)}
              >
                <Download size={16} />
              </Button>
            )}
          {checkedOrders.length > 0 && filter !== "local" && (
            <div
              className="orders-selection-bar"
              role="region"
              aria-label="Selected order actions"
            >
              <span aria-live="polite">
                <strong>{checkedOrders.length}</strong> selected
              </span>
              <div className="orders-selection-actions">
                <ActionMenu
                  title="Update selected orders"
                  description="Only eligible orders will be updated."
                  trigger={
                    <Button disabled={selectionDisabled}>
                      Actions <ChevronDown size={15} />
                    </Button>
                  }
                  items={(["confirm", "fulfill", "cancel"] as const)
                    .filter((action) =>
                      canUse(bootstrap, "orders", `orders.${action}`),
                    )
                    .map((action) => ({
                      label: `${actionLabels[action]} orders (${eligibleOrders(action).length})`,
                      disabled:
                        selectionDisabled ||
                        eligibleOrders(action).length === 0,
                      onSelect: () => {
                        const orders = eligibleOrders(action);
                        setBulkResult(null);
                        setBulkProgress(0);
                        setBulkReview({
                          action,
                          orders,
                          skipped: checkedOrders.length - orders.length,
                        });
                      },
                    }))}
                />
                <Button disabled={busy} onClick={() => setCheckedIds([])}>
                  Clear selection
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="save-announcement" aria-live="polite">
          {message}
        </div>
        <ErrorMessage error={query.error} />
        <ResultsMotion
          motionKey={`${filter}:${search}:${cursor ?? "first"}`}
          pending={
            online &&
            filter !== "local" &&
            (query.isPlaceholderData || query.isLoading)
          }
          id="order-results"
          role="tabpanel"
          aria-label="Orders"
          tabIndex={0}
        >
          {filter === "local" ? (
            drafts.length ? (
              <div className="table-wrap orders-table-wrap">
                <Table className="orders-table">
                  <thead>
                    <tr>
                      <th>Local draft</th>
                      <th>State</th>
                      <th>Updated</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <strong>
                            {d.input.customerName || "Untitled draft"}
                          </strong>
                          <div className="small muted">
                            {d.input.lines.length} product lines
                          </div>
                        </td>
                        <td>
                          <Badge
                            tone={d.state === "conflict" ? "red" : "amber"}
                          >
                            {d.state === "uploading"
                              ? "Upload pending"
                              : d.state === "conflict"
                                ? "Conflict"
                                : "Saved on this device"}
                          </Badge>
                        </td>
                        <td className="small muted">
                          {new Date(d.updatedAt).toLocaleString()}
                        </td>
                        <td>
                          <Button
                            onClick={() => {
                              setEditor(d);
                              setError(undefined);
                              setConflictVersion(null);
                            }}
                          >
                            Open draft
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={d.state === "uploading"}
                            onClick={() => {
                              setDiscardDraft(d);
                              setDiscardError(undefined);
                            }}
                          >
                            Discard
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : (
              <Empty
                title="No local drafts"
                description="Drafts saved on this device appear here. They become shared orders only after you upload them."
              />
            )
          ) : query.isLoading && online ? (
            <ContentSkeleton label="Loading orders" />
          ) : rows.length ? (
            <>
              <div className="table-wrap orders-table-wrap">
                <Table className="orders-table">
                  <thead>
                    <tr>
                      {canBulk && (
                        <th className="order-select-cell">
                          <Checkbox
                            aria-label="Select all orders on this page"
                            checked={checkedOrders.length === rows.length}
                            indeterminate={
                              checkedOrders.length > 0 &&
                              checkedOrders.length < rows.length
                            }
                            disabled={selectionDisabled}
                            onCheckedChange={(checked) =>
                              setCheckedIds(
                                checked ? rows.map((order) => order.id) : [],
                              )
                            }
                          />
                        </th>
                      )}
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Status</th>
                      <th className="order-extra">Items</th>
                      <th className="order-extra">Date</th>
                      <th className="numeric">Total</th>
                      <th>
                        <span className="sr-only">Open order</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((order) => (
                      <tr
                        key={order.id}
                        data-selected={checkedIds.includes(order.id)}
                        data-inspected={selected?.id === order.id}
                      >
                        {canBulk && (
                          <td className="order-select-cell">
                            <Checkbox
                              aria-label={`Select order ${order.number}`}
                              checked={checkedIds.includes(order.id)}
                              disabled={selectionDisabled}
                              onCheckedChange={(checked) =>
                                setCheckedIds((ids) =>
                                  checked
                                    ? [...ids, order.id]
                                    : ids.filter((id) => id !== order.id),
                                )
                              }
                            />
                          </td>
                        )}
                        <td>
                          <button
                            className="link-button order-number"
                            onClick={() => {
                              setSelected(order);
                              setError(undefined);
                            }}
                          >
                            #{order.number}
                          </button>
                        </td>
                        <td>
                          <div className="customer-name">
                            <strong>{order.customerName}</strong>
                          </div>
                        </td>
                        <td>
                          {pending.some((p) => p.orderId === order.id) ? (
                            <Badge tone="amber">Action pending</Badge>
                          ) : (
                            <Status status={order.status} />
                          )}
                        </td>
                        <td className="order-extra muted">
                          {order.lines?.reduce((n, l) => n + l.quantity, 0)}{" "}
                          units
                        </td>
                        <td className="order-extra muted">
                          {new Date(order.createdAt).toLocaleDateString("en", {
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                        <td className="numeric">
                          <Money
                            minor={order.totalMinor}
                            currency={bootstrap.workspace.currency}
                          />
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            aria-label={`Open order ${order.number}`}
                            onClick={() => {
                              setSelected(order);
                              setError(undefined);
                            }}
                          >
                            <ChevronDown
                              size={16}
                              style={{ transform: "rotate(-90deg)" }}
                            />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="row-between">
                <span className="list-caption">
                  {rows.length} {rows.length === 1 ? "order" : "orders"} on this
                  page
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
              title={
                search || filter !== "all"
                  ? "No matching orders"
                  : online
                    ? "No orders yet"
                    : "No orders cached"
              }
              description={
                search || filter !== "all"
                  ? "Try another status or clear your search."
                  : online
                    ? "Use New order to create a draft."
                    : "Connect to refresh your orders. You can still create a local draft if storage is enabled."
              }
              action={
                (search || filter !== "all") && (
                  <Button
                    onClick={() => {
                      setSearch("");
                      setFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
          )}
        </ResultsMotion>
      </div>
      <Modal
        open={!!bulkReview}
        onOpenChange={(open) => !busy && !open && setBulkReview(null)}
        title={
          bulkResult
            ? "Bulk action results"
            : `${bulkReview ? actionLabels[bulkReview.action] : "Update"} selected orders`
        }
        description={
          bulkResult
            ? "Each order is saved separately. Review the results below."
            : bulkReview
              ? actionEffects[bulkReview.action]
              : ""
        }
      >
        {bulkReview && (
          <div className="form-stack">
            {bulkResult ? (
              <>
                <p role="status">
                  {bulkResult.succeeded} of {bulkReview.orders.length} orders
                  updated.
                </p>
                {bulkResult.failures.length > 0 && (
                  <>
                    <p>
                      These orders remain selected. Review the errors, then use
                      Actions to try again. Pending actions reuse the original
                      request safely.
                    </p>
                    <ul className="bulk-order-review">
                      {bulkResult.failures.map((failure) => (
                        <li key={failure.number}>
                          <strong>#{failure.number}</strong>
                          <ErrorMessage error={failure.error} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : (
              <>
                <p>
                  <strong>{bulkReview.orders.length}</strong>{" "}
                  {bulkReview.orders.length === 1 ? "order" : "orders"} will be
                  updated.
                  {bulkReview.skipped > 0 &&
                    ` ${bulkReview.skipped} selected ${bulkReview.skipped === 1 ? "order is" : "orders are"} ineligible and will be skipped.`}
                </p>
                <ul className="bulk-order-review" aria-label="Orders to update">
                  {bulkReview.orders.map((order) => (
                    <li key={order.id}>
                      <span>#{order.number}</span>
                      <strong>{order.customerName}</strong>
                      <Status status={order.status} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="form-footer">
              <Button disabled={busy} onClick={() => setBulkReview(null)}>
                {bulkResult ? "Done" : "Go back"}
              </Button>
              {!bulkResult && (
                <Button
                  variant={
                    bulkReview.action === "cancel" ? "danger" : "primary"
                  }
                  disabled={busy || !online || bulkReview.orders.length === 0}
                  onClick={() => void runBulk()}
                >
                  {busy
                    ? `Updating ${bulkProgress} of ${bulkReview.orders.length}…`
                    : `${actionLabels[bulkReview.action]} ${bulkReview.orders.length} ${bulkReview.orders.length === 1 ? "order" : "orders"}`}
                </Button>
              )}
            </div>
            {!online && <p className="notice">Connect to update orders.</p>}
          </div>
        )}
      </Modal>
      <DetailPanel
        open={!!selected}
        onOpenChange={(open) => !busy && !open && setSelected(null)}
        title={selected ? `Order #${selected.number}` : "Order"}
      >
        {selected && (
          <div className="order-detail">
            <Status status={selected.status} />
            <dl className="order-properties">
              <dt>Customer</dt>
              <dd>{selected.customerName}</dd>
              <dt>Order date</dt>
              <dd>
                {new Date(selected.createdAt).toLocaleDateString("en", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </dd>
              <dt>Order number</dt>
              <dd>#{selected.number}</dd>
              <dt>Currency</dt>
              <dd>{bootstrap.workspace.currency}</dd>
            </dl>
            <section className="order-items" aria-label="Order items">
              <h3>Items ({selected.lines?.length ?? 0})</h3>
              {selected.lines?.map((line) => (
                <div className="order-item" key={line.productId}>
                  <span className="item-symbol">
                    <Package size={21} />
                  </span>
                  <div>
                    <strong>{line.name}</strong>
                    <small>
                      {line.quantity} ×{" "}
                      <Money
                        minor={line.priceMinor}
                        currency={bootstrap.workspace.currency}
                      />
                    </small>
                  </div>
                  <span>
                    <Money
                      minor={line.quantity * line.priceMinor}
                      currency={bootstrap.workspace.currency}
                    />
                  </span>
                </div>
              ))}
            </section>
            <div className="order-total">
              <span>Total</span>
              <strong>
                <Money
                  minor={selected.totalMinor}
                  currency={bootstrap.workspace.currency}
                />
              </strong>
            </div>
            <p className="small">
              {selected.lines?.reduce((sum, line) => sum + line.quantity, 0) ??
                0}{" "}
              units
              {selected.status === "confirmed"
                ? " reserved"
                : selected.status === "fulfilled"
                  ? " fulfilled"
                  : selected.status === "draft"
                    ? ", not yet reserved"
                    : ", order cancelled"}
            </p>
            <ErrorMessage error={orderDetail.error} />
            <ErrorMessage error={error} />
            {pending.some((p) => p.orderId === selected.id) && (
              <div className="notice">
                The last response was not received. Retry the pending action to
                retrieve its result safely.
              </div>
            )}
            <div className="form-footer">
              {selected.status === "draft" &&
                canUse(bootstrap, "orders", "orders.edit") && (
                  <Button
                    onClick={() => editRemote(selected)}
                    disabled={
                      busy || pending.some((p) => p.orderId === selected.id)
                    }
                  >
                    Edit draft
                  </Button>
                )}
              {online && pending.find((p) => p.orderId === selected.id) ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    const p = pending.find((p) => p.orderId === selected.id)!;
                    void command(
                      selected,
                      (
                        {
                          orderConfirm: "confirm",
                          orderFulfill: "fulfill",
                          orderCancel: "cancel",
                        } as const
                      )[p.operation],
                    );
                  }}
                  disabled={busy}
                >
                  Retry pending action
                </Button>
              ) : (
                <>
                  {online &&
                    ["draft", "confirmed"].includes(selected.status) &&
                    canUse(bootstrap, "orders", "orders.cancel") && (
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => void command(selected, "cancel")}
                      >
                        Cancel order
                      </Button>
                    )}
                  {online &&
                    selected.status === "draft" &&
                    canUse(bootstrap, "orders", "orders.confirm") && (
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => void command(selected, "confirm")}
                      >
                        <Check size={16} />
                        {busy ? "Confirming…" : "Confirm and reserve stock"}
                      </Button>
                    )}
                  {online &&
                    selected.status === "confirmed" &&
                    canUse(bootstrap, "orders", "orders.fulfill") && (
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => void command(selected, "fulfill")}
                      >
                        <Truck size={16} />
                        {busy ? "Saving…" : "Mark fulfilled"}
                      </Button>
                    )}
                </>
              )}
            </div>
            <section className="order-activity" aria-label="Order activity">
              <h3>Activity</h3>
              <ol>
                {(selected.activity?.length
                  ? selected.activity
                  : [
                      {
                        action: "orders.created",
                        createdAt: selected.createdAt,
                      },
                    ]
                ).map((event, index) => (
                  <li key={event.createdAt + index}>
                    <Tooltip
                      content={new Date(event.createdAt).toLocaleString()}
                    >
                      <time dateTime={event.createdAt} tabIndex={0}>
                        {new Date(event.createdAt).toLocaleDateString("en", {
                          month: "short",
                          day: "numeric",
                        })}
                      </time>
                    </Tooltip>
                    <span>
                      {{
                        "orders.created": "Order created",
                        "orders.updated": "Draft updated",
                        "orders.confirmed": "Stock reserved",
                        "orders.fulfilled": "Order fulfilled",
                        "orders.cancelled": "Order cancelled",
                      }[event.action] ?? "Order updated"}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </DetailPanel>
      <Modal
        open={!!discardDraft}
        onOpenChange={(open) => !open && !discardBusy && setDiscardDraft(null)}
        title="Discard this draft?"
        description="This removes the draft from this device. This cannot be undone."
      >
        <p>{discardDraft?.input.customerName || "Untitled draft"}</p>
        <ErrorMessage error={discardError} />
        <div className="form-footer">
          <Button
            autoFocus
            disabled={discardBusy}
            onClick={() => setDiscardDraft(null)}
          >
            Keep draft
          </Button>
          <Button
            variant="danger"
            disabled={discardBusy}
            onClick={async () => {
              if (!discardDraft) return;
              setDiscardBusy(true);
              try {
                await updateDraft(discardDraft, true);
                setDiscardDraft(null);
                toast.add({ title: "Local draft discarded" });
              } catch (error) {
                setDiscardError(error);
              } finally {
                setDiscardBusy(false);
              }
            }}
          >
            {discardBusy ? "Discarding…" : "Discard draft"}
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!editor}
        onOpenChange={(open) => !busy && !open && setEditor(null)}
        title={editor?.remoteId ? "Edit order draft" : "New order draft"}
        description="Stock is reserved when you confirm this draft online."
        wide
        className="order-editor-dialog"
      >
        {editor && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (online ? upload() : saveLocal());
            }}
            className="form-stack order-editor-form"
          >
            <section className="editor-section" aria-label="Customer details">
              <Field label="Customer">
                <Input
                  autoFocus
                  required
                  maxLength={200}
                  value={editor.input.customerName}
                  disabled={editor.state === "uploading"}
                  onChange={(e) =>
                    changeInput({
                      ...editor.input,
                      customerName: e.target.value,
                    })
                  }
                  placeholder="Company or customer name"
                />
              </Field>
            </section>
            <section className="editor-section" aria-label="Order lines">
              <div className="editor-section-heading">
                <h3>Items</h3>
                <span>
                  {editor.input.lines.length}{" "}
                  {editor.input.lines.length === 1 ? "line" : "lines"}
                </span>
              </div>
              {online && (
                <SearchField
                  placeholder="Search by name or SKU"
                  value={productSearch}
                  onChange={setProductSearch}
                />
              )}
              <div className="draft-lines">
                {editor.input.lines.map((line, i) => (
                  <div className="draft-line" key={i}>
                    <Field label={`Product ${i + 1}`}>
                      <Select
                        required
                        value={line.productId}
                        disabled={editor.state === "uploading"}
                        onValueChange={(e) => {
                          const p = products.find((p) => p.id === e);
                          changeInput({
                            ...editor.input,
                            lines: editor.input.lines.map((l, j) =>
                              j === i
                                ? {
                                    ...l,
                                    productId: e,
                                    priceMinor: p?.priceMinor ?? 0,
                                  }
                                : l,
                            ),
                          });
                        }}
                      >
                        <SelectOption value="">Choose a product</SelectOption>
                        {line.productId &&
                          !products.some((p) => p.id === line.productId) && (
                            <SelectOption value={line.productId}>
                              Selected product
                            </SelectOption>
                          )}
                        {products
                          .filter((p) => p.active)
                          .map((p) => (
                            <SelectOption key={p.id} value={p.id}>
                              {p.name} ({p.available} available)
                            </SelectOption>
                          ))}
                      </Select>
                    </Field>
                    <Field label="Quantity">
                      <NumberInput
                        required

                        min={1}
                        max={1000000}
                        step={1}
                        value={line.quantity}
                        disabled={editor.state === "uploading"}
                        onValueChange={(e) =>
                          changeInput({
                            ...editor.input,
                            lines: editor.input.lines.map((l, j) =>
                              j === i ? { ...l, quantity: Number(e) } : l,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Field
                      label={`Unit price (${bootstrap.workspace.currency})`}
                    >
                      <NumberInput
                        required

                        min={0}
                        step="0.01"
                        value={line.priceMinor / 100}
                        disabled={editor.state === "uploading"}
                        onValueChange={(e) =>
                          changeInput({
                            ...editor.input,
                            lines: editor.input.lines.map((l, j) =>
                              j === i
                                ? {
                                    ...l,
                                    priceMinor: Math.round(Number(e) * 100),
                                  }
                                : l,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Button
                      variant="ghost"
                      type="button"
                      aria-label={`Remove line ${i + 1}`}
                      disabled={
                        editor.input.lines.length === 1 ||
                        editor.state === "uploading"
                      }
                      onClick={() =>
                        changeInput({
                          ...editor.input,
                          lines: editor.input.lines.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="order-summary">
                <Button
                  type="button"
                  disabled={
                    editor.state === "uploading" ||
                    editor.input.lines.length >= 100
                  }
                  onClick={() =>
                    changeInput({
                      ...editor.input,
                      lines: [
                        ...editor.input.lines,
                        { productId: "", quantity: 1, priceMinor: 0 },
                      ],
                    })
                  }
                >
                  <Plus size={16} />
                  Add line
                </Button>
              </div>
            </section>
            <ErrorMessage error={error} />
            {conflictVersion && (
              <div className="notice">
                <strong>Server version {conflictVersion.version}</strong>
                <p>
                  {conflictVersion.customerName}, {conflictVersion.status}. Your
                  draft is preserved.
                </p>
                <div className="actions">
                  <Button
                    type="button"
                    onClick={() => {
                      changeInput({
                        customerName: conflictVersion.customerName,
                        lines: conflictVersion.lines!.map((l) => ({
                          productId: l.productId,
                          quantity: l.quantity,
                          priceMinor: l.priceMinor,
                        })),
                      });
                      setEditor((prev) =>
                        prev
                          ? { ...prev, baseVersion: conflictVersion.version }
                          : null,
                      );
                      setConflictVersion(null);
                    }}
                  >
                    Use server version
                  </Button>
                  {conflictVersion.status === "draft" && (
                    <Button
                      type="button"
                      onClick={() => {
                        setEditor({
                          ...editor,
                          baseVersion: conflictVersion.version,
                          moduleVersion: props.definition.version,
                          state: "local",
                          uploadKey: crypto.randomUUID(),
                        });
                        setConflictVersion(null);
                        setError(undefined);
                      }}
                    >
                      Keep my changes for review
                    </Button>
                  )}
                </div>
              </div>
            )}
            {editor.state === "uploading" && !busy && (
              <div className="notice">
                Upload outcome unknown. Retry with the same request before
                editing this draft.
              </div>
            )}
            <div className="form-footer">
              <div className="editor-total">
                <span>Order total</span>{" "}
                <strong>
                  <Money
                    minor={editor.input.lines.reduce(
                      (sum, l) => sum + l.quantity * l.priceMinor,
                      0,
                    )}
                    currency={bootstrap.workspace.currency}
                  />
                </strong>
              </div>
              {online && offlineEnabled && editor.state !== "uploading" && (
                <Button
                  type="button"
                  onClick={() => void saveLocal()}
                  disabled={busy}
                >
                  Save on this device
                </Button>
              )}
              {online && (
                <Button
                  variant="primary"
                  type="submit"
                  disabled={busy || !!conflictVersion}
                >
                  <Upload size={16} />
                  {busy
                    ? "Saving…"
                    : editor.state === "uploading"
                      ? "Retry upload"
                      : "Save to server"}
                </Button>
              )}
              {!online && (
                <Button
                  variant="primary"
                  type="submit"
                  disabled={busy || !offlineEnabled}
                >
                  Save on this device
                </Button>
              )}
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={exportsOpen}
        onOpenChange={setExportsOpen}
        title="Export orders"
        description="Exports are generated in the background and checked against your current access."
      >
        <Button
          onClick={async () => {
            try {
              await client.request({
                operation: "exportCreate",
                params,
                body: {},
                idempotencyKey: crypto.randomUUID(),
              });
              await exportsQuery.refetch();
            } catch (e) {
              setError(e);
            }
          }}
        >
          <Plus size={16} />
          Create CSV export
        </Button>
        <ErrorMessage error={error} />
        <div className="export-list">
          {exportsQuery.data?.map((e) => (
            <div className="list-row" key={e.id}>
              <div>
                <strong>Orders export</strong>
                <div className="small muted">
                  {new Date(e.createdAt).toLocaleString()}
                </div>
              </div>
              <Status status={e.state} />
              {e.state === "ready" && (
                <Button
                  aria-label="Download export"
                  onClick={async () => {
                    try {
                      const file = await client.request({
                        operation: "exportDownload",
                        params: { ...params, id: e.id },
                      });
                      await platform.saveFile(file.filename, file.content);
                    } catch (e) {
                      setError(e);
                      onError(e);
                    }
                  }}
                >
                  <Download size={16} />
                </Button>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function FulfillmentSummary({
  days,
  confirmed,
  draft,
  onFilter,
}: {
  days: { date: string; count: number }[];
  confirmed: number;
  draft: number;
  onFilter: (status: string) => void;
}) {
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const maximum = Math.max(1, ...days.map((day) => day.count));
  const label = (date: string, weekday = false) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(
      "en",
      weekday
        ? { weekday: "short", timeZone: "UTC" }
        : { month: "short", day: "numeric", timeZone: "UTC" },
    );
  return (
    <section
      className="fulfillment-summary"
      aria-label="Order workload and fulfillment activity"
    >
      <div className="orders-workload">
        <button className="workload-link" onClick={() => onFilter("confirmed")}>
          <span>
            Awaiting fulfillment <ArrowUpRight size={14} />
          </span>
          <strong>{confirmed.toLocaleString()}</strong>
        </button>
        <button
          className="link-button workload-drafts"
          onClick={() => onFilter("draft")}
        >
          {draft.toLocaleString()} {draft === 1 ? "draft" : "drafts"} to review{" "}
          <ArrowUpRight size={13} />
        </button>
      </div>
      <div className="orders-activity">
        <div className="orders-activity-heading">
          <h2>
            Fulfillment activity <span>{total.toLocaleString()} in 7 days</span>
          </h2>
          <span>
            {days.length > 0 &&
              `${label(days[0].date)} – ${label(days.at(-1)!.date)}`}{" "}
            (UTC)
          </span>
        </div>
        {total > 0 ? (
          <figure
            className="orders-activity-chart"
            aria-label={`${total} orders fulfilled over the last 7 days. Daily counts, UTC; today is still in progress.`}
          >
            {days.map((day, index) => (
              <Tooltip
                key={day.date}
                content={`${label(day.date)}: ${day.count} ${day.count === 1 ? "order" : "orders"} fulfilled${index === days.length - 1 ? ". Today is still in progress." : ""}`}
              >
                <div
                  className="orders-activity-day"
                  tabIndex={0}
                  role="img"
                  aria-label={`${label(day.date)}: ${day.count} fulfilled orders`}
                >
                  <span className="orders-activity-plot">
                    <span
                      className="orders-activity-bar"
                      style={{ height: `${(day.count / maximum) * 100}%` }}
                    >
                      <span className="orders-activity-count">
                        {day.count.toLocaleString()}
                      </span>
                    </span>
                  </span>
                  <span>
                    {index === days.length - 1
                      ? "Today"
                      : label(day.date, true)}
                  </span>
                </div>
              </Tooltip>
            ))}
          </figure>
        ) : (
          <p className="orders-activity-empty">
            No orders fulfilled in the last 7 days.
          </p>
        )}
      </div>
    </section>
  );
}
