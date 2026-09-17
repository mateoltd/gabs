import { Table } from "@suite/ui-web";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router";
import type { FeatureProps } from "@suite/client";
import { canUse } from "@suite/client";
import {
  Button,
  Empty,
  ErrorMessage,
  ContentSkeleton,
  Money,
  PageHeading,
  Status,
  SegmentedControl,
} from "@suite/ui-web";
import {
  ArrowRight,
  ArrowUpRight,
  Package,
  Plus,
  FileText,
  CheckCircle2,
} from "@suite/ui-web/icons";
import type { Order } from "@suite/contracts";
import { OrderActivity, OrderWorkload, StockHealth } from "./overview-insights";

export function Overview({
  client,
  scope,
  bootstrap,
  online,
  snapshot,
  offlineEnabled,
  moduleCatalog,
}: FeatureProps) {
  const [orderView, setOrderView] = useState("recent");
  const query = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "overview"],
    queryFn: () =>
      client.request({
        operation: "overview",
        params: { workspaceId: scope.workspaceId },
      }),
    enabled: online,
  });
  const orders = online ? query.data?.orders : undefined;
  const inventory = online ? query.data?.inventory : undefined;
  const recent = online ? (orders?.recent ?? []) : (snapshot?.orders ?? []);
  const canCreate =
    canUse(bootstrap, "orders", "orders.create", moduleCatalog) &&
    (online || offlineEnabled);
  const isStarting = Boolean(
    online &&
    (orders || inventory) &&
    !(
      orders &&
      orders.draft + orders.confirmed + orders.fulfilled + orders.cancelled
    ) &&
    !inventory?.products,
  );
  const showingQueue = online && orderView === "ready";
  const shownOrders = showingQueue ? (orders?.ready ?? []) : recent.slice(0, 6);
  const orderLink = (order: Order) =>
    online ? `/orders?order=${order.id}` : "/orders";
  return (
    <div className="overview-page">
      <PageHeading
        title="Overview"
        description={
          isStarting
            ? "Your products, orders, and daily activity in one place."
            : "Keep orders moving and stock in check."
        }
        actions={
          !isStarting &&
          canCreate && (
            <NavLink className="button primary" to="/orders?new=1">
              <Plus size={17} />
              New order
            </NavLink>
          )
        }
      />
      <ErrorMessage error={online ? query.error : undefined} />
      {online && query.isPending ? (
        <ContentSkeleton label="Loading workspace overview" overview />
      ) : online && query.isError ? (
        <Button onClick={() => void query.refetch()}>Retry overview</Button>
      ) : isStarting ? (
        <section className="overview-start" aria-labelledby="start-heading">
          <div className="overview-start-heading">
            <h2 id="start-heading">No activity yet</h2>
            <p>
              Start with{" "}
              {inventory ? "your product catalog" : "your first order"}.
              Products and orders will appear here once they’re added.
            </p>
          </div>
          <div className="overview-start-actions">
            {inventory && (
              <div className="overview-start-step">
                <Package size={20} />
                <div>
                  <h3>Your product catalog</h3>
                  <p>Manage products, prices, and available stock.</p>
                </div>
                <NavLink className="button primary" to="/inventory">
                  Open inventory <ArrowRight size={15} />
                </NavLink>
              </div>
            )}
            {orders && (
              <div className="overview-start-step">
                <FileText size={20} />
                <div>
                  <h3>{canCreate ? "Your first order" : "Your orders"}</h3>
                  <p>
                    {canCreate
                      ? "Choose a customer, add items, and save a draft."
                      : "Orders will appear here when your team creates them."}
                  </p>
                </div>
                <NavLink
                  className={`button ${inventory ? "" : "primary"}`}
                  to={canCreate ? "/orders?new=1" : "/orders"}
                >
                  {canCreate ? "New order" : "View orders"}{" "}
                  <ArrowRight size={15} />
                </NavLink>
              </div>
            )}
          </div>
        </section>
      ) : (
        <>
          {online && (orders || inventory) && (
            <div
              className={`overview-insights ${orders ? "has-orders" : ""} ${inventory ? "has-inventory" : ""}`}
            >
              {orders && (
                <>
                  <OrderWorkload
                    draft={orders.draft}
                    confirmed={orders.confirmed}
                    onOpenQueue={() => setOrderView("ready")}
                  />
                  <OrderActivity days={orders.fulfilledDaily} />
                </>
              )}
              {inventory && <StockHealth {...inventory} />}
            </div>
          )}
          <div
            className={`overview-content ${orders && inventory ? "both-modules" : ""}`}
          >
            {(orders || !online) && (
              <section
                className="overview-recent"
                aria-labelledby="overview-orders-heading"
              >
                <div className="section-heading row-between">
                  <h2 id="overview-orders-heading">
                    {online ? "Orders" : "Cached orders"}
                  </h2>
                  <NavLink
                    className="link-button"
                    to={showingQueue ? "/orders?status=confirmed" : "/orders"}
                  >
                    {showingQueue ? "View queue" : "View orders"}{" "}
                    <ArrowUpRight size={14} />
                  </NavLink>
                </div>
                {online && orders && (
                  <div className="overview-order-tabs">
                    <SegmentedControl
                      panelId="overview-order-results"
                      label="Overview orders"
                      value={orderView}
                      onChange={setOrderView}
                      options={[
                        {
                          value: "ready",
                          label: (
                            <>
                              Ready to fulfill{" "}
                              <span className="overview-tab-count">
                                {orders.confirmed}
                              </span>
                            </>
                          ),
                        },
                        {
                          value: "recent",
                          label: (
                            <>
                              Recent orders{" "}
                              <span className="overview-tab-count">
                                {recent.length}
                              </span>
                            </>
                          ),
                        },
                      ]}
                    />
                  </div>
                )}
                <div
                  id="overview-order-results"
                  role={online ? "tabpanel" : undefined}
                  aria-label={
                    online
                      ? showingQueue
                        ? "Ready to fulfill"
                        : "Recent orders"
                      : undefined
                  }
                >
                  {shownOrders.length ? (
                    <div className="table-wrap">
                      <Table>
                        <thead>
                          <tr>
                            <th>Order</th>
                            <th>Customer</th>
                            <th>Status</th>
                            <th className="numeric">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shownOrders.map((order) => (
                            <tr key={order.id}>
                              <td>
                                <span className="mono">#{order.number}</span>
                              </td>
                              <td>
                                <NavLink
                                  className="recent-customer"
                                  aria-label={`Open order ${order.number} for ${order.customerName}`}
                                  to={orderLink(order)}
                                >
                                  {order.customerName}
                                </NavLink>
                              </td>
                              <td>
                                <Status status={order.status} />
                              </td>
                              <td className="numeric">
                                <Money
                                  minor={order.totalMinor}
                                  currency={bootstrap.workspace.currency}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  ) : (
                    <div className="overview-quiet-empty">
                      <CheckCircle2 size={18} />
                      <div>
                        <strong>
                          {showingQueue
                            ? "No orders awaiting fulfillment"
                            : "No orders yet"}
                        </strong>
                        <p>
                          {showingQueue
                            ? "Confirmed orders will appear here."
                            : "Create an order draft to get started."}
                        </p>
                      </div>
                    </div>
                  )}
                  {online && orders ? (
                    <p className="data-caption">
                      {showingQueue
                        ? `${orders.confirmed > shownOrders.length ? `Showing the ${shownOrders.length} oldest of ${orders.confirmed} confirmed orders. ` : ""}Stock is reserved for confirmed orders.`
                        : orders.confirmed > 0
                          ? `${orders.confirmed} ${orders.confirmed === 1 ? "order ready" : "orders ready"} to fulfill. Open the queue to review.`
                          : "Your latest orders, newest first."}
                    </p>
                  ) : (
                    <p className="data-caption">
                      Showing saved records from this device. Connect to refresh
                      totals and work queues.
                    </p>
                  )}
                </div>
              </section>
            )}
            {online && inventory && (
              <section
                className="overview-stock-panel"
                aria-labelledby="stock-heading"
              >
                <div className="queue-heading">
                  <h2 id="stock-heading">Stock to review</h2>
                  <NavLink className="link-button" to="/inventory?stock=low">
                    View all {inventory.lowStock > 0 && inventory.lowStock}{" "}
                    <ArrowUpRight size={14} />
                  </NavLink>
                </div>
                {inventory.lowStockItems.length ? (
                  <div className="stock-watch">
                    {inventory.lowStockItems.map((product) => (
                      <NavLink
                        key={product.id}
                        to={`/inventory?search=${encodeURIComponent(product.sku)}`}
                      >
                        <div>
                          <strong>{product.name}</strong>
                          <span className="mono">{product.sku}</span>
                        </div>
                        <span className="stock-level">
                          <strong>{product.available}</strong>
                          <small>
                            {product.available === 0
                              ? "Out of stock"
                              : "available"}
                          </small>
                        </span>
                      </NavLink>
                    ))}
                  </div>
                ) : (
                  <div className="overview-quiet-empty">
                    {inventory.products ? (
                      <CheckCircle2 size={18} />
                    ) : (
                      <Package size={18} />
                    )}
                    <div>
                      <strong>
                        {inventory.products
                          ? "Stock levels are above 10 units"
                          : "No products yet"}
                      </strong>
                      <p>
                        {inventory.products
                          ? "No stock needs attention."
                          : "Open inventory to start your product catalog."}
                      </p>
                    </div>
                  </div>
                )}
                <p className="queue-footer">
                  {inventory.lowStock > inventory.lowStockItems.length
                    ? `Showing ${inventory.lowStockItems.length} of ${inventory.lowStock} low-stock products. `
                    : "Lowest availability first. "}
                  Reserved units excluded.
                </p>
              </section>
            )}
          </div>
          {online && query.data && !orders && !inventory && (
            <Empty
              title="No modules available"
              description="Open Modules to check availability or request access."
              action={
                <NavLink className="button" to="/modules">
                  Open modules
                </NavLink>
              }
            />
          )}
        </>
      )}
    </div>
  );
}
