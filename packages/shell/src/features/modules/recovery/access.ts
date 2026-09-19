import { canReadSnapshot, type FeatureProps } from "@suite/client";

/** Consent and the current workspace authorization bound all saved-work inspection. */
export function canReadSavedWork(props: FeatureProps, connected = false) {
  if (
    !props.offlineEnabled ||
    props.bootstrap.workspace.id !== props.scope.workspaceId
  )
    return false;
  const now = Date.now();
  const authorizedAt = Date.parse(props.bootstrap.authorizedAt);
  if (props.online && navigator.onLine)
    return (
      authorizedAt <= now &&
      now <
        authorizedAt + Math.max(props.bootstrap.offlineHours, 1 / 60) * 3600000
    );
  return (
    !connected &&
    canReadSnapshot(props.snapshot, now) &&
    props.snapshot.bootstrap.workspace.id === props.scope.workspaceId &&
    props.snapshot.bootstrap.authorizedAt === props.bootstrap.authorizedAt &&
    now < authorizedAt + Math.min(props.bootstrap.offlineHours, 24) * 3600000
  );
}
