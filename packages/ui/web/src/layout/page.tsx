import type { ReactNode } from "react";

export function PageHeading({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}

export function Money({
  minor,
  currency = "EUR",
}: {
  minor: number;
  currency?: string;
}) {
  return (
    <>
      {new Intl.NumberFormat("en", { style: "currency", currency }).format(
        minor / 100,
      )}
    </>
  );
}
