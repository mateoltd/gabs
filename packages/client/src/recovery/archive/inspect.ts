import {
  authorizeWorkImport,
  type SavedWorkImportOptions,
} from "../import/authority";
import { savedWorkFingerprint } from "../import/format";
import { parseSavedWorkArchive, type SavedWorkArchive } from "./format";

/** Decryption is not permission: return only copies allowed by current server observations. */
export async function inspectSavedWorkArchive(
  options: SavedWorkImportOptions,
  value: SavedWorkArchive,
) {
  const archive = parseSavedWorkArchive(JSON.stringify(value), options.scope);
  const copies = [];
  let unavailable = 0;
  for (const input of archive.copies) {
    options.signal.throwIfAborted();
    options.check();
    try {
      const authority = await authorizeWorkImport(options, input);
      copies.push({
        input,
        digest: await savedWorkFingerprint(input),
        moduleName: authority.module.name,
        access: authority.access,
        check: authority.check,
      });
    } catch (error) {
      options.signal.throwIfAborted();
      options.check();
      unavailable++;
    }
  }
  for (const copy of copies) copy.check();
  options.check();
  return { copies, unavailable };
}
