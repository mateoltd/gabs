import { NavLink } from "react-router";
import { Tooltip } from "@suite/ui-web";
import { ArrowUpRight } from "@suite/ui-web/icons";

export function OrderWorkload({
  draft,
  confirmed,
  onOpenQueue,
}: {
  draft: number;
  confirmed: number;
  onOpenQueue: () => void;
}) {
  return (
    <section
      className="overview-insight workload-insight"
      aria-label="Order workload"
    >
      <h2 className="overview-summary-title">Order queue</h2>
      <div className="workload-summary">
        <button
          className="metric workload-ready"
          type="button"
          onClick={onOpenQueue}
          aria-controls="overview-order-results"
          aria-label={`Ready to fulfill ${confirmed}`}
        >
          <strong className="insight-value">
            {confirmed.toLocaleString()}
          </strong>
          <span className="insight-label">Ready to fulfill</span>
          <ArrowUpRight size={14} />
        </button>
        <NavLink className="metric overview-drafts" to="/orders?status=draft">
          <strong className="insight-value">{draft.toLocaleString()}</strong>
          <span className="insight-label">Draft orders</span>
          <ArrowUpRight size={14} />
        </NavLink>
      </div>
    </section>
  );
}

export function OrderActivity({
  days,
}: {
  days: { date: string; count: number }[];
}) {
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const maximum = Math.max(1, ...days.map((day) => day.count));
  const dateLabel = (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  const latest = days.at(-1);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section
      className="overview-insight activity-insight"
      aria-label="Order activity"
    >
      <div className="insight-heading">
        <h2>Orders fulfilled</h2>
        <strong className="insight-value">{total.toLocaleString()}</strong>
      </div>
      <div className="insight-body">
        {total > 0 ? (
          <figure
            className="activity-chart"
            aria-label={`${total} orders fulfilled over the last seven days, UTC. Bar heights show daily order counts.`}
          >
            {days.map((day, index) => (
              <Tooltip
                key={day.date}
                content={`${dateLabel(day.date)}: ${day.count} fulfilled ${day.count === 1 ? "order" : "orders"}${day.date === today ? " so far" : ""}`}
              >
                <span
                  className={`activity-day ${index === days.length - 1 ? "latest" : ""}`}
                  role="img"
                  aria-label={`${dateLabel(day.date)}: ${day.count} fulfilled orders`}
                >
                  <span className="activity-count" aria-hidden="true">
                    {day.count}
                  </span>
                  <span className="activity-bar-space">
                    <span
                      className="activity-bar"
                      style={{ height: `${(day.count / maximum) * 100}%` }}
                    />
                  </span>
                  <span className="activity-date" aria-hidden="true">
                    {new Date(`${day.date}T12:00:00Z`).toLocaleDateString(
                      "en",
                      { weekday: "short", timeZone: "UTC" },
                    )}
                  </span>
                </span>
              </Tooltip>
            ))}
          </figure>
        ) : (
          <span className="insight-quiet-note">
            No fulfilled orders this week
          </span>
        )}
      </div>
      <div className="insight-footer">
        <span>
          {days.length > 0 &&
            `${dateLabel(days[0].date)}–${dateLabel(latest!.date)}, UTC`}
        </span>
      </div>
    </section>
  );
}

export function StockHealth({
  products,
  lowStock,
  available,
}: {
  products: number;
  lowStock: number;
  available: number;
}) {
  const share = products ? lowStock / products : 0;
  return (
    <section
      className="overview-insight stock-insight"
      aria-label="Stock health"
    >
      <NavLink className="metric insight-label" to="/inventory?stock=low">
        Low-stock products <ArrowUpRight size={14} />
      </NavLink>
      <div className="insight-body">
        <div>
          <strong className="insight-value">{lowStock.toLocaleString()}</strong>
          <NavLink className="metric insight-denominator" to="/inventory">
            of {products.toLocaleString()} active products
          </NavLink>
        </div>
        {products > 0 && (
          <Tooltip
            content={`${Math.round(share * 100)}% of products have 10 or fewer units available. Each square represents 4% of products.`}
          >
            <div
              className="stock-waffle"
              role="img"
              aria-label={`${lowStock} of ${products} active products have 10 or fewer available units. ${products - lowStock} have more than 10.`}
            >
              {Array.from({ length: 25 }, (_, index) => (
                <span
                  key={index}
                  className="stock-waffle-cell"
                  aria-hidden="true"
                >
                  <i
                    style={{
                      height: `${Math.max(0, Math.min(1, share * 25 - index)) * 100}%`,
                    }}
                  />
                </span>
              ))}
            </div>
          </Tooltip>
        )}
      </div>
      <div className="insight-footer">
        <span>{available.toLocaleString()} units available</span>
        <span>Low at 10 units</span>
      </div>
    </section>
  );
}
