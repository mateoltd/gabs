import type { ReactNode } from "react";
import { AlertCircle, LoaderCircle, PackageOpen } from "../controls/icons";

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Status({
  status,
  label,
}: {
  status: string;
  label?: ReactNode;
}) {
  return (
    <span className={`status status-${status}`}>
      {label ?? status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="error-message" role="alert">
      <AlertCircle size={18} />
      <span>{error instanceof Error ? error.message : String(error)}</span>
    </div>
  );
}

export function Loading({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="empty loading-state" role="status">
      <LoaderCircle size={24} />
      <p>{label}</p>
    </div>
  );
}

export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <PackageOpen size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
