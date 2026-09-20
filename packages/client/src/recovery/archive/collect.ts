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

export interface AvailableArchiveWork {
  input: SavedWorkArchive["copies"][number];
  digest: string;
  check(): void;
}

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

/** Discover every currently available source copy from one storage snapshot. */
export async function collectAvailableArchiveWork(
  source: ModuleStorage,
  scope: Scope,
  authorize: (input: SavedWorkArchive["copies"][number]) => Promise<() => void>,
  check: () => void,
): Promise<{ copies: AvailableArchiveWork[]; unavailable: number }> {
  check();
  const selections: ArchiveWorkSelection[] = [
    ...source.journal
      .filter(
        (entry) =>
          !entry.supersededBy &&
          entry.userId === scope.userId &&
          entry.workspaceId === scope.workspaceId,
      )
      .map((entry) => ({ kind: "request" as const, requestId: entry.id })),
    ...Object.keys(source.drafts).map((draftKey) => ({
      kind: "draft" as const,
      draftKey,
    })),
    ...Object.keys(source.recoveryImports ?? {}).map((digest) => ({
      kind: "retained" as const,
      digest,
    })),
  ];
  const copies = new Map<string, AvailableArchiveWork>();
  let unavailable = 0;
  for (const selection of selections) {
    check();
    try {
      const archive = await collectSavedWorkArchive(
        source,
        scope,
        [selection],
        check,
      );
      const input = archive.copies[0];
      const digest = await savedWorkFingerprint(input);
      check();
      if (copies.has(digest)) continue;
      const guard = await authorize(input);
      check();
      copies.set(digest, { input, digest, check: guard });
    } catch {
      check();
      unavailable++;
    }
  }
  check();
  for (const copy of copies.values()) copy.check();
  check();
  return { copies: [...copies.values()], unavailable };
}
