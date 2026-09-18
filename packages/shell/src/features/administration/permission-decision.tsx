/** The matrix previews draft policy; module review displays the server's saved-policy result. */
export function PermissionDecision({
  decision,
}: {
  decision?: {
    allowed: boolean;
    grants: readonly string[];
    denies: readonly string[];
  };
}) {
  if (!decision) return <small>Permission could not be evaluated.</small>;
  return (
    <small className="small">
      {decision.denies.length ? (
        <>
          <span>Denied by {decision.denies.join(", ")}</span>
          {!!decision.grants.length && (
            <>
              <br />
              <span>Overrides grants from {decision.grants.join(", ")}</span>
            </>
          )}
        </>
      ) : decision.allowed ? (
        <span>Allowed by {decision.grants.join(", ")}</span>
      ) : (
        <span>No permission granted</span>
      )}
    </small>
  );
}
