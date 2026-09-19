import { useEffect, useRef, useState } from "react";
import type { FeatureProps } from "@suite/client";
import { changeModuleStorage } from "@suite/client/module-storage";
import { clearReferenceCache } from "@suite/client/reference-reads";
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
  const clear = async (kind: "pages" | "labels") => {
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
        if (kind === "pages") clearDownloadedResourcePages(state);
        else clearReferenceCache(state);
      });
      if (currentScope())
        setNotice(
          kind === "pages"
            ? "Downloaded lists and recent pages cleared. Drafts and pending changes are unchanged."
            : "Downloaded reference labels cleared. Drafts and pending changes are unchanged.",
        );
    } catch (error) {
      if (currentScope()) setError(error);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <section aria-label="Downloaded records and labels">
      <h3>Downloaded records and labels</h3>
      <div className="actions">
        <Button
          disabled={busy || !canReadSavedWork(props)}
          onClick={() => void clear("pages")}
        >
          Clear downloaded lists and pages
        </Button>
        <Button
          disabled={busy || !canReadSavedWork(props)}
          onClick={() => void clear("labels")}
        >
          Clear downloaded reference labels
        </Button>
      </div>
      <ErrorMessage error={error} />
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
