import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { canUse, type FeatureProps } from "@suite/client";
import { Modal, SearchField, ErrorMessage } from "@suite/ui-web";
import {
  Search,
  Package,
  ShoppingBag,
  ArrowUpRight,
  LayoutGrid,
  Settings,
  Layers,
  Users,
  ShieldCheck,
} from "@suite/ui-web/icons";

export function WorkspaceSearch({
  client,
  scope,
  bootstrap,
  online,
  moduleCatalog,
}: FeatureProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 180);
    return () => clearTimeout(timer);
  }, [text]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    setOpen(false);
    setText("");
    setSearch("");
  }, [scope.workspaceId]);
  const orders = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "search-orders", search],
    queryFn: () =>
      client.request({
        operation: "orders",
        params: { workspaceId: scope.workspaceId },
        query: { search, limit: 5 },
      }),
    enabled:
      open &&
      online &&
      !!search &&
      canUse(bootstrap, "orders", "orders.read", moduleCatalog),
  });
  const inventory =
    canUse(bootstrap, "inventory", "inventory.read", moduleCatalog) ||
    canUse(
      bootstrap,
      "inventory",
      "inventory.availability.read",
      moduleCatalog,
    );
  const products = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "search-products", search],
    queryFn: () =>
      client.request({
        operation: "products",
        params: { workspaceId: scope.workspaceId },
        query: { search, limit: 5 },
      }),
    enabled: open && online && !!search && inventory,
  });
  const pages = [
    { name: "Overview", path: "/overview", icon: LayoutGrid, allowed: true },
    {
      name: "Orders",
      path: "/orders",
      icon: ShoppingBag,
      allowed: canUse(bootstrap, "orders", "orders.read", moduleCatalog),
    },
    {
      name: "Inventory",
      path: "/inventory",
      icon: Package,
      allowed: inventory,
    },
    { name: "Modules", path: "/modules", icon: Layers, allowed: true },
    {
      name: "People & access",
      path: "/people",
      icon: Users,
      allowed: bootstrap.permissions.includes("members.manage"),
    },
    {
      name: "Audit history",
      path: "/audit",
      icon: ShieldCheck,
      allowed: bootstrap.permissions.includes("audit.read"),
    },
    { name: "Settings", path: "/settings", icon: Settings, allowed: true },
  ].filter(
    (page) =>
      page.allowed && page.name.toLowerCase().includes(text.toLowerCase()),
  );
  return (
    <>
      <button
        className="global-search"
        onClick={() => setOpen(true)}
        aria-label="Search workspace"
      >
        <Search size={16} />
        <span>Search</span>
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Search workspace"
        className="command-dialog"
        description="Find pages, orders by customer, and products by name or SKU."
      >
        <div
          className="command-content"
          onKeyDown={(event) => {
            const links = Array.from(
              event.currentTarget.querySelectorAll<HTMLAnchorElement>(
                ".search-results a",
              ),
            );
            if (!links.length) return;
            const index = links.indexOf(
              document.activeElement as HTMLAnchorElement,
            );
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const next =
                index < 0
                  ? event.key === "ArrowDown"
                    ? 0
                    : links.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      links.length) %
                    links.length;
              links[next]?.focus();
            } else if (
              event.key === "Enter" &&
              event.target instanceof HTMLInputElement
            ) {
              event.preventDefault();
              links[0]?.click();
            }
          }}
        >
          <SearchField
            autoFocus
            value={text}
            onChange={setText}
            placeholder="Search this workspace"
          />
          <div className="search-results">
            {!!pages.length && (
              <section aria-label="Pages">
                <h3>{text ? "Pages" : "Go to"}</h3>
                {pages.map((page) => (
                  <NavLink
                    key={page.path}
                    to={page.path}
                    onClick={() => setOpen(false)}
                  >
                    <span className="search-result-icon">
                      <page.icon size={19} />
                    </span>
                    <span>{page.name}</span>
                    <ArrowUpRight size={15} />
                  </NavLink>
                ))}
              </section>
            )}
            {!!search && online && !!orders.data?.items.length && (
              <section aria-label="Orders">
                <h3>Orders</h3>
                {orders.data.items.map((order) => (
                  <NavLink
                    key={order.id}
                    to={`/orders?order=${order.id}`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="search-result-icon">
                      <ShoppingBag size={19} />
                    </span>
                    <span>
                      {order.customerName}
                      <small>Order #{order.number}</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </NavLink>
                ))}
              </section>
            )}
            {!!search && online && !!products.data?.items.length && (
              <section aria-label="Products">
                <h3>Products</h3>
                {products.data.items.map((product) => (
                  <NavLink
                    key={product.id}
                    to={`/inventory?search=${encodeURIComponent(product.sku)}`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="search-result-icon">
                      <Package size={19} />
                    </span>
                    <span>
                      {product.name}
                      <small>{product.sku}</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </NavLink>
                ))}
              </section>
            )}
            <div className="search-status" role="status">
              {orders.isFetching ||
              products.isFetching ||
              text.trim() !== search
                ? "Searching…"
                : search &&
                    !pages.length &&
                    !orders.data?.items.length &&
                    !products.data?.items.length &&
                    !orders.error &&
                    !products.error
                  ? online
                    ? "No matches. Try a customer, product, or page name."
                    : "Connect to search orders and products."
                  : null}
              {!online &&
                !search &&
                "Pages are available offline. Connect to search orders and products."}
            </div>
          </div>
          <div className="search-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> Navigate
            </span>
            <span>
              <kbd>↵</kbd> Open
            </span>
            <span>
              <kbd>esc</kbd> Close
            </span>
          </div>
        </div>
        <ErrorMessage error={orders.error || products.error} />
      </Modal>
    </>
  );
}
