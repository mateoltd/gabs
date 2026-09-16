import type { ComponentProps, ReactNode } from "react";

/** Shared list geometry for operational screens; content and permissions stay local. */
export function ListPage({ className = "", ...props }: ComponentProps<"div">) {
  return <div {...props} className={`list-page ${className}`} />;
}
export function ListToolbar({
  className = "",
  ...props
}: ComponentProps<"div">) {
  return <div {...props} className={`list-toolbar ${className}`} />;
}
export function Table({ className = "", ...props }: ComponentProps<"table">) {
  return <table {...props} className={`list-table ${className}`} />;
}
export function ListTable(props: ComponentProps<"table">) {
  return (
    <div className="table-wrap list-table-wrap">
      <Table {...props} />
    </div>
  );
}
export function SummaryStrip({
  className = "",
  ...props
}: ComponentProps<"section">) {
  return <section {...props} className={`summary-strip ${className}`} />;
}
export function RecordIdentity({
  symbol,
  primary,
  secondary,
}: {
  symbol?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="record-identity">
      {symbol && (
        <span className="record-symbol" aria-hidden="true">
          {symbol}
        </span>
      )}
      <div>
        <strong>{primary}</strong>
        {secondary && <span className="record-secondary">{secondary}</span>}
      </div>
    </div>
  );
}
