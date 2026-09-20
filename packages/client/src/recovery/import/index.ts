import { canonical } from "@suite/module-sdk/registry";
import { changeModuleStorage } from "../../modules/storage";
import { authorizeWorkImport, type SavedWorkImportOptions } from "./authority";
import {
  parseSavedWorkImport,
  savedWorkFingerprint,
  recoverySize,
  savedWorkImportLimit,
} from "./format";
export {
  parseSavedWorkImport,
  savedWorkImportLimit,
  type SavedWorkImport,
} from "./format";
export type { SavedWorkImportOptions, ImportAccess } from "./authority";
export { promoteSavedWorkImport } from "./promote";
export { inspectSavedWorkImport, discardSavedWorkImport } from "./stored";

/** Imported observations remain separate from executable journals and server receipts. */
export async function stageSavedWorkImport(
  options: SavedWorkImportOptions,
  text: string,
) {
  const scope = { ...options.scope };
  const input = parseSavedWorkImport(text, scope);
  const authority = await authorizeWorkImport(options, input);
  const serialized = canonical(input);
  const digest = await savedWorkFingerprint(input);
  let alreadyImported = false;
  await changeModuleStorage(
    options.platform,
    scope,
    (state) => {
      authority.check();
      const imports = state.recoveryImports ?? {};
      const existing = imports[digest];
      if (existing) {
        if (canonical(existing.input) !== serialized)
          throw Error(
            "The stored recovery copy changed. Retain the source file.",
          );
        alreadyImported = true;
        return;
      }
      const next = { ...imports, [digest]: { input, receivedAt: Date.now() } };
      if (
        Object.keys(next).length > 32 ||
        recoverySize(JSON.stringify(next)) > savedWorkImportLimit
      )
        throw Error(
          "Saved-work import storage is full. Retain this file until previous imports are resolved.",
        );
      state.recoveryImports = next;
      // Contracts, permissions, leases and file-supplied execution state are deliberately not installed.
    },
    authority.check,
  );
  return { digest, alreadyImported };
}
