import {
  readModuleStorage,
  changeModuleStorage,
  type ModuleStorage,
} from "../../modules/storage";
import { parseSavedWorkImport, savedWorkFingerprint } from "./format";
import { authorizeWorkImport, type SavedWorkImportOptions } from "./authority";
export async function readImportSource(
  state: ModuleStorage,
  digest: string,
  options: SavedWorkImportOptions,
) {
  if (
    !/^[a-f0-9]{64}$/.test(digest) ||
    !Object.hasOwn(state.recoveryImports ?? {}, digest)
  )
    throw Error("The imported copy is no longer available.");
  const imported = state.recoveryImports![digest];
  const input = parseSavedWorkImport(
    JSON.stringify(imported.input),
    options.scope,
  );
  if ((await savedWorkFingerprint(input)) !== digest)
    throw Error(
      "The imported copy changed. Retain the original recovery file.",
    );
  return { imported, input };
}

/** Inspection rechecks current authority; saved files never bootstrap their own permission. */
export async function inspectSavedWorkImport(
  options: SavedWorkImportOptions,
  digest: string,
) {
  options.signal.throwIfAborted();
  options.check();
  const state = await readModuleStorage(options.platform, options.scope);
  const { imported, input } = await readImportSource(state, digest, options);
  const authority = await authorizeWorkImport(options, input);
  authority.check();
  return {
    digest,
    input,
    receivedAt: imported.receivedAt,
    promotion: imported.promotion,
    moduleName: authority.module.name,
    access: authority.access,
  };
}
/** Explicit removal affects only this imported copy, never its promoted work or original file. */
export async function discardSavedWorkImport(
  options: SavedWorkImportOptions,
  digest: string,
) {
  const scope = { ...options.scope };
  return navigator.locks.request(
    `suite-sync:${scope.userId}:${scope.workspaceId}`,
    async () => {
      options.signal.throwIfAborted();
      options.check();
      const { input } = await readImportSource(
        await readModuleStorage(options.platform, scope),
        digest,
        options,
      );
      const authority = await authorizeWorkImport(options, input);
      await changeModuleStorage(
        options.platform,
        scope,
        async (state) => {
          await readImportSource(state, digest, options);
          authority.check();
          delete state.recoveryImports![digest];
        },
        authority.check,
      );
    },
  );
}
