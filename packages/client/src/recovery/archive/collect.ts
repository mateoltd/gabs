import type { Scope } from "../../index";
import type { ModuleStorage } from "../../modules/storage";
import { createSavedWorkRecovery } from "../work";
import { parseSavedWorkImport, savedWorkFingerprint } from "../import/format";
import {
  parseSavedWorkArchive,
  savedWorkArchiveCopies,
  type SavedWorkArchive,
} from "./format";

export type ArchiveWorkSelection =
  | { kind: "request"; requestId: string }
  | { kind: "draft"; draftKey: string }
  | { kind: "retained"; digest: string };

/** Capture explicit source selections. Authorization and file delivery belong to the host. */
export async function collectSavedWorkArchive(
  source: ModuleStorage,
  scope: Scope,
  selections: readonly ArchiveWorkSelection[],
  check: () => void,
) {
  check();
  scope = { userId: scope.userId, workspaceId: scope.workspaceId };
  if (!selections.length || selections.length > savedWorkArchiveCopies)
    throw Error("Choose between 1 and 256 saved-work items for this archive.");
  // One consistent snapshot survives caller mutations while source contracts are verified.
  const state = structuredClone(source);
  const copies = new Map<string, SavedWorkArchive["copies"][number]>();
  for (const selection of selections) {
    check();
    let input: SavedWorkArchive["copies"][number];
    if (selection.kind === "retained") {
      const copy = state.recoveryImports?.[selection.digest];
      if (!copy)
        throw Error("A selected imported copy is no longer available.");
      input = parseSavedWorkImport(JSON.stringify(copy.input), scope);
      if ((await savedWorkFingerprint(input)) !== selection.digest)
        throw Error(
          "A selected imported copy changed. Keep its original file.",
        );
    } else if (selection.kind === "request") {
      const entry = state.journal.find(
        (item) => item.id === selection.requestId,
      );
      if (!entry) throw Error("A selected request is no longer available.");
      input = await createSavedWorkRecovery(state, scope, entry.call.moduleId, {
        requestId: entry.id,
      });
    } else {
      input = await createSavedWorkRecovery(
        state,
        scope,
        selection.draftKey.split("/")[0],
        {
          draftKey: selection.draftKey,
        },
      );
    }
    check();
    copies.set(await savedWorkFingerprint(input), input);
  }
  check();
  return parseSavedWorkArchive(
    JSON.stringify({
      kind: "corporate-saved-work",
      formatVersion: 1,
      ...scope,
      createdAt: Date.now(),
      copies: [...copies.values()],
    }),
    scope,
  );
}
