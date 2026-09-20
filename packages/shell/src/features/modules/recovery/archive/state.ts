import { authorizeRecoveryExport } from "@suite/client/work-export";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FeatureProps } from "@suite/client";
import { saveWorkArchive } from "@suite/client/browser";
import { readModuleStorage } from "@suite/client/module-storage";
import {
  collectSavedWorkArchive,
  inspectSavedWorkArchive,
  openSavedWorkArchive,
  encryptedWorkArchiveLimit,
  savedWorkFingerprint,
  type ArchiveWorkSelection,
} from "@suite/client/work-archive";
import {
  stageSavedWorkImports,
  type SavedWorkImportOptions,
} from "@suite/client/work-import";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";
import { canReadSavedWork } from "../access";

interface Copy {
  input: SavedWorkRecovery;
  digest: string;
  moduleName: string;
  check(): void;
}

/** Archive files retain snapshots; admission and business restoration remain explicit separate actions. */
export function useArchive(props: FeatureProps) {
  const latest = useRef(props);
  latest.current = props;
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(false);
  const [open, setOpen] = useState(false),
    [mode, setMode] = useState<"export" | "import">("export");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState(""),
    [unavailable, setUnavailable] = useState(0);
  const [copies, setCopies] = useState<Copy[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [revision, setRevision] = useState<string | number>();
  const [passphrase, setPassphrase] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [file, setFile] = useState<File>();
  const [, tick] = useState(0);
  const clear = () => {
    setCopies([]);
    setSelected([]);
    setPassphrase("");
    setConfirmation("");
    setNotice("");
    setUnavailable(0);
  };
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useLayoutEffect(() => {
    controller.current?.abort();
    clear();
    setFile(undefined);
    setError(undefined);
  }, [
    props.scope.userId,
    props.scope.workspaceId,
    props.offlineEnabled,
    props.online,
  ]);
  useLayoutEffect(() => {
    if (copies.length)
      setNotice(
        "Workspace access changed. Load saved work or unlock the archive again to check current access.",
      );
    setCopies([]);
    setSelected([]);
    setPassphrase("");
    setConfirmation("");
  }, [props.bootstrap.policyRevision]);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [open]);
  const allowed = canReadSavedWork(props, mode === "import");
  const visible =
    allowed && revision === props.bootstrap.policyRevision
      ? copies.filter((copy) => {
          try {
            copy.check();
            return true;
          } catch {
            return false;
          }
        })
      : [];
  useEffect(() => {
    if (!allowed) {
      controller.current?.abort();
      clear();
    }
  }, [allowed]);
  const run = async (
    action: (options: SavedWorkImportOptions) => Promise<void>,
  ) => {
    if (busy || !allowed) return;
    const captured = latest.current;
    const abort =
      controller.current && !controller.current.signal.aborted
        ? controller.current
        : new AbortController();
    controller.current = abort;
    const options: SavedWorkImportOptions = {
      client: captured.client,
      platform: captured.platform,
      scope: captured.scope,
      signal: abort.signal,
      check: (access) => {
        abort.signal.throwIfAborted();
        const p = latest.current;
        if (
          !mounted.current ||
          p.scope.userId !== captured.scope.userId ||
          p.scope.workspaceId !== captured.scope.workspaceId ||
          !canReadSavedWork(p, mode === "import") ||
          (access &&
            (!access.permissions.every((permission) =>
              p.bootstrap.permissions.includes(permission),
            ) ||
              !access.modules.every((id) =>
                p.bootstrap.modules.some(
                  (module) =>
                    module.moduleId === id &&
                    module.state === "enabled" &&
                    module.assigned &&
                    module.entitled,
                ),
              )))
        )
          throw Error("Unlock this workspace with current access to continue.");
      },
      receivePolicy: (policy, signal) =>
        latest.current.receivePolicy(policy, signal),
    };
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      options.check();
      await action(options);
    } catch (failure) {
      if (mounted.current && !abort.signal.aborted) {
        setError(failure);
        latest.current.onError(failure);
      }
    } finally {
      if (mounted.current && controller.current === abort) setBusy(false);
    }
  };
  const authorize = (
    options: SavedWorkImportOptions,
    input: SavedWorkRecovery,
  ) =>
    authorizeRecoveryExport({
      ...options,
      input,
      check: () => options.check(),
      receivePolicy: (policy, signal) =>
        latest.current.receivePolicy(policy, signal),
      onError: (failure) => latest.current.onError(failure),
      access: () => {
        const p = latest.current;
        return {
          policy: p.bootstrap,
          dependencies: p.moduleCatalog.dependencies(input.moduleId),
          module: p.moduleCatalog.definition(input.moduleId),
          online: p.online,
          offlineEnabled: p.offlineEnabled,
        };
      },
    });
  const load = async (options: SavedWorkImportOptions) => {
    const state = await readModuleStorage(options.platform, options.scope);
    options.check();
    const selections: ArchiveWorkSelection[] = [
      ...state.journal
        .filter(
          (entry) =>
            !entry.supersededBy &&
            entry.userId === options.scope.userId &&
            entry.workspaceId === options.scope.workspaceId,
        )
        .map((entry) => ({ kind: "request" as const, requestId: entry.id })),
      ...Object.keys(state.drafts).map((draftKey) => ({
        kind: "draft" as const,
        draftKey,
      })),
      ...Object.keys(state.recoveryImports ?? {}).map((digest) => ({
        kind: "retained" as const,
        digest,
      })),
    ];
    const next = new Map<string, Copy>();
    let failed = 0;
    for (const selection of selections) {
      options.check();
      try {
        const archive = await collectSavedWorkArchive(
          state,
          options.scope,
          [selection],
          () => options.check(),
        );
        const input = archive.copies[0],
          digest = await savedWorkFingerprint(input);
        if (next.has(digest)) continue;
        const check = await authorize(options, input);
        next.set(digest, {
          input,
          digest,
          check,
          moduleName:
            latest.current.moduleCatalog.definition(input.moduleId)?.name ??
            input.moduleId,
        });
      } catch (failure) {
        options.check();
        failed++;
      }
    }
    options.check();
    for (const copy of next.values()) copy.check();
    setCopies([...next.values()]);
    setSelected([]);
    setUnavailable(failed);
    setRevision(latest.current.bootstrap.policyRevision);
    if (!next.size && !failed)
      setNotice("There is no saved work to archive in this workspace.");
  };
  const chosen = visible.filter((copy) => selected.includes(copy.digest));
  const unlock = () =>
    void run(async (options) => {
      setCopies([]);
      setSelected([]);
      try {
        const archive = await openSavedWorkArchive(
          await file!.text(),
          passphrase,
          options.scope,
          () => options.check(),
        );
        const result = await inspectSavedWorkArchive(options, archive);
        options.check();
        setCopies(result.copies);
        setUnavailable(result.unavailable);
        setRevision(latest.current.bootstrap.policyRevision);
        if (!result.copies.length)
          setNotice(
            "No copies in this archive are available under your current access. Keep the original file.",
          );
      } finally {
        setPassphrase("");
      }
    });
  const save = () =>
    void run(async (options) => {
      try {
        const guards: (() => void)[] = [];
        for (const copy of chosen)
          guards.push(await authorize(options, copy.input));
        const check = () => {
          options.check();
          for (const guard of guards) guard();
        };
        const result = await saveWorkArchive({
          archive: {
            kind: "corporate-saved-work",
            formatVersion: 1,
            ...options.scope,
            createdAt: Date.now(),
            copies: chosen.map((copy) => copy.input),
          },
          passphrase,
          signal: options.signal,
          check,
        });
        options.check();
        setNotice(
          result.status === "cancelled"
            ? "Archive save cancelled. Saved work is unchanged."
            : "Encrypted archive saved or offered for download. Keep its passphrase separately.",
        );
      } finally {
        setPassphrase("");
        setConfirmation("");
      }
    });
  const admit = () =>
    void run(async (options) => {
      const result = await stageSavedWorkImports(
        options,
        chosen.map((copy) => JSON.stringify(copy.input)),
      );
      options.check();
      setSelected([]);
      setNotice(
        `${result.filter((copy) => !copy.alreadyImported).length} ${result.filter((copy) => !copy.alreadyImported).length === 1 ? "copy" : "copies"} imported for review. Close this dialog and open Import saved work to restore them. Existing work was preserved.`,
      );
    });
  const openArchive = () => {
    clear();
    setError(undefined);
    setOpen(true);
  };
  const onOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) {
      controller.current?.abort();
      clear();
      setFile(undefined);
    }
  };
  const selectMode = (value: "export" | "import") => {
    clear();
    setError(undefined);
    setMode(value);
  };
  const chooseFile = (chosen?: File) => {
    clear();
    setError(undefined);
    setFile(undefined);
    if (chosen && chosen.size > encryptedWorkArchiveLimit)
      setError(Error("This encrypted archive is too large."));
    else setFile(chosen);
  };
  return {
    open,
    mode,
    busy,
    error,
    notice,
    unavailable,
    visible,
    selected,
    setSelected,
    passphrase,
    setPassphrase,
    confirmation,
    setConfirmation,
    file,
    chosen,
    allowed,
    openArchive,
    onOpenChange,
    selectMode,
    chooseFile,
    load: () => void run(load),
    unlock,
    save,
    admit,
  };
}
