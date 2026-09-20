import { randomUUID } from "node:crypto";
import { readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ensureIntegrityDirectory,
  integrityDirectory,
  readIntegrityFile,
  syncIntegrityDirectory,
  writeIntegrityFile,
} from "./files";
import {
  parseIntegrityEvent,
  parseIntegrityIncident,
  parseIntegrityRepair,
  type IntegrityFailure,
  type IntegrityRepair,
} from "./format";
import { IntegrityJournal } from "./journal";
import {
  inspectIntegrityRecords,
  integrityRepairPending,
  repairFile,
} from "./report";

function incident(repair: IntegrityRepair) {
  return {
    id: repair.id,
    at: repair.at,
    release: repair.release,
    failure: { code: "unreadable-audit" as const },
  };
}
function same(left: unknown, right: unknown) {
  if (JSON.stringify(left) !== JSON.stringify(right))
    throw Error("Integrity recovery evidence does not match.");
}
async function receipt(root: string, repair: IntegrityRepair) {
  same(
    parseIntegrityRepair(await readIntegrityFile(resolve(root, "repair.json"))),
    repair,
  );
}
async function complete(root: string, repair: IntegrityRepair) {
  await receipt(root, repair);
  if ((await readIntegrityFile(resolve(root, "lockdown.json"))) !== undefined)
    throw Error("Integrity recovery is incomplete.");
  for (const kind of ["locked", "recovered"] as const) {
    const event = parseIntegrityEvent(
      await readIntegrityFile(resolve(root, `${repair.id}.${kind}.json`)),
    );
    if (event.event !== kind) throw Error("Integrity recovery is incomplete.");
    same(event.incident, incident(repair));
  }
}
/** Single-instance maintenance only. Retained evidence is never overwritten or deleted. */
export async function repairIntegrity(options: {
  profile: string;
  release: string;
  inspect(): Promise<IntegrityFailure | undefined>;
  clearSession(): Promise<void>;
}) {
  const verify = async () => {
    if (await options.inspect())
      throw Error(
        "Repair the application installation before its integrity records.",
      );
  };
  await verify();
  const profile = options.profile;
  const active = resolve(profile, "integrity");
  let repair: IntegrityRepair;
  if (await integrityRepairPending(profile)) {
    repair = parseIntegrityRepair(
      await readIntegrityFile(resolve(profile, repairFile)),
    );
  } else {
    const audit = await inspectIntegrityRecords(active);
    if (audit.state !== "unreadable") return { changed: false as const };
    // A linked directory cannot be retained as the application's own evidence.
    if (!(await integrityDirectory(active)))
      throw Error("Original integrity records are unavailable.");
    repair = parseIntegrityRepair({
      version: 1,
      kind: "audit-repair",
      id: randomUUID(),
      at: new Date().toISOString(),
      release: options.release,
    });
    await writeIntegrityFile(profile, repairFile, repair);
  }
  const retainedName = `integrity-retained-${repair.id}`;
  const retained = resolve(profile, retainedName);
  const staged = resolve(profile, `integrity-staged-${repair.id}`);
  const hasOriginal = await integrityDirectory(active);
  const hasRetained = await integrityDirectory(retained);
  const hasStaged = await integrityDirectory(staged);
  if (hasRetained && hasOriginal) {
    // Promotion may have committed before the final acknowledgement.
    if (hasStaged) throw Error("Ambiguous integrity recovery state.");
    await complete(active, repair);
  } else {
    if (!hasRetained && !hasOriginal)
      throw Error("Original integrity records are unavailable.");
    if (hasRetained) {
      if (!hasStaged) throw Error("Staged integrity records are unavailable.");
      await complete(staged, repair);
    } else {
      if (!hasStaged) await ensureIntegrityDirectory(staged);
      const marker = await readIntegrityFile(resolve(staged, "repair.json"));
      if (marker === undefined) {
        // A crash during the first atomic marker write may leave private temporary
        // files. Retain them; unrelated names must never be adopted as our stage.
        if (
          (await readdir(staged, { withFileTypes: true })).some(
            (entry) =>
              !entry.isFile() ||
              !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/.test(
                entry.name,
              ),
          )
        )
          throw Error("Unrecognized integrity staging directory.");
        await writeIntegrityFile(staged, "repair.json", repair);
      } else same(parseIntegrityRepair(marker), repair);
      const recovered = await readIntegrityFile(
        resolve(staged, `${repair.id}.recovered.json`),
      );
      const flag = await readIntegrityFile(resolve(staged, "lockdown.json"));
      if (flag !== undefined)
        same(parseIntegrityIncident(flag), incident(repair));
      if (recovered === undefined && flag === undefined)
        await writeIntegrityFile(staged, "lockdown.json", incident(repair));
      await new IntegrityJournal(staged, options.release).record(
        undefined,
        options.clearSession,
      );
      await complete(staged, repair);
    }
    // Recheck on resumed publication, even if staging already acknowledged recovery.
    await options.clearSession();
    await verify();
    if (!hasRetained) {
      await rename(active, retained);
      await syncIntegrityDirectory(profile);
    }
    await rename(staged, active);
    await syncIntegrityDirectory(profile);
    await complete(active, repair);
  }
  await options.clearSession();
  await rm(resolve(profile, repairFile));
  await syncIntegrityDirectory(profile);
  return { changed: true as const, retained: retainedName };
}
