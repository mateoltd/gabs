import { useEffect, useRef, useState } from "react";
import type { FeatureProps } from "@suite/client";
import { changeModuleStorage } from "@suite/client/module-storage";
import { clearDownloadedResourcePages } from "@suite/client/offline-lists";
import { Button, ErrorMessage } from "@suite/ui-web";
import { canReadSavedWork } from "../recovery/access";

/** Deleting disposable copies requires workspace access, never access to retained business input. */
export function ClearDownloads(props: FeatureProps) {
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    setError(undefined);
    setNotice(undefined);
  }, [props.scope.userId, props.scope.workspaceId]);
  return (
    <section aria-label="Downloaded record pages">
      <h3>Downloaded record pages</h3>
      <Button
        disabled={busy || !canReadSavedWork(props)}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          setNotice(undefined);
          const currentScope = () =>
            mounted.current &&
            latest.current.scope.userId === props.scope.userId &&
            latest.current.scope.workspaceId === props.scope.workspaceId;
          try {
            await changeModuleStorage(props.platform, props.scope, (state) => {
              if (!currentScope() || !canReadSavedWork(latest.current))
                throw Error(
                  "Current access does not allow clearing this workspace’s downloads.",
                );
              clearDownloadedResourcePages(state);
            });
            if (currentScope())
              setNotice(
                "Downloaded lists and recent pages cleared. Drafts and pending changes are unchanged.",
              );
          } catch (error) {
            if (currentScope()) setError(error);
          } finally {
            if (mounted.current) setBusy(false);
          }
        }}
      >
        Clear downloaded lists and pages
      </Button>
      <ErrorMessage error={error} />
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
