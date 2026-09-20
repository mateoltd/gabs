import { canonical } from "@suite/module-sdk/registry";
import { changeModuleStorage } from "../../modules/storage";
import { authorizeWorkImport, type SavedWorkImportOptions } from "./authority";
import {
  parseSavedWorkImport,
  savedWorkFingerprint,
  recoverySize,
  savedWorkImportLimit,
} from "./format";

/** All selected copies enter inert storage together, or none do. Replay preserves prior work. */
export async function stageSavedWorkImports(
  options: SavedWorkImportOptions,
  texts: readonly string[],
) {
  options.signal.throwIfAborted();
  options.check();
  if (!texts.length || texts.length > 32)
    throw Error("Choose between 1 and 32 copies to import together.");
  const scope = { ...options.scope };
  const inputs = texts.map((text) => parseSavedWorkImport(text, scope));
  const selected = new Map<
    string,
    { input: (typeof inputs)[number]; serialized: string }
  >();
  for (const input of inputs) {
    const digest = await savedWorkFingerprint(input);
    const serialized = canonical(input);
    const prior = selected.get(digest);
    if (prior && prior.serialized !== serialized)
      throw Error("Two selected recovery copies have conflicting identities.");
    selected.set(digest, { input, serialized });
  }
  if (
    recoverySize(
      JSON.stringify([...selected.values()].map(({ input }) => input)),
    ) > savedWorkImportLimit
  )
    throw Error(
      "Selected recovery copies exceed the 1 MiB admission limit. Import a smaller selection.",
    );
  const authorities: Awaited<ReturnType<typeof authorizeWorkImport>>[] = [];
  for (const { input } of selected.values())
    authorities.push(await authorizeWorkImport(options, input));
  // Authorization of later copies can outlive the earlier policy observation.
  if (selected.size > 1)
    for (const authority of authorities) await authority.refresh();
  const check = () => {
    options.signal.throwIfAborted();
    options.check();
    for (const authority of authorities) authority.check();
  };
  const results: { digest: string; alreadyImported: boolean }[] = [];
  check();
  await changeModuleStorage(
    options.platform,
    scope,
    (state) => {
      check();
      const next = { ...state.recoveryImports };
      for (const [digest, { input, serialized }] of selected) {
        const existing = next[digest];
        if (existing && canonical(existing.input) !== serialized)
          throw Error(
            "The stored recovery copy changed. Retain the source file.",
          );
        results.push({ digest, alreadyImported: !!existing });
        next[digest] ??= { input, receivedAt: Date.now() };
      }
      if (
        results.some((result) => !result.alreadyImported) &&
        (Object.keys(next).length > 32 ||
          recoverySize(JSON.stringify(next)) > savedWorkImportLimit)
      )
        throw Error(
          "Saved-work import storage is full. Retain this file until previous imports are resolved.",
        );
      state.recoveryImports = next;
      // Never import journal effects, signed contracts, leases or promotion receipts.
    },
    check,
  );
  return results;
}

export async function stageSavedWorkImport(
  options: SavedWorkImportOptions,
  text: string,
) {
  return (await stageSavedWorkImports(options, [text]))[0];
}
