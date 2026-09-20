import { randomUUID } from "node:crypto";
import { link, lstat, open, opendir, realpath, rm } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  integrityDirectory,
  readIntegrityFile,
  syncIntegrityDirectory,
} from "./files";
import {
  integrityId,
  parseIntegrityEvent,
  parseIntegrityIncident,
  parseIntegrityRepair,
  type IntegrityEvent,
  type IntegrityFailure,
  type IntegrityIncident,
  type IntegrityRepair,
} from "./format";

const eventName = /^([a-f0-9-]{36})\.(locked|recovered)\.json$/;
const retainedName = /^integrity-retained-([a-f0-9-]{36})$/;
export const repairFile = "integrity-repair.json";
export async function integrityRepairPending(profile: string) {
  try {
    await lstat(resolve(profile, repairFile));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
type RecordValue = IntegrityIncident | IntegrityEvent | IntegrityRepair;
type AuditRecord =
  | { name: string; state: "readable"; value: RecordValue }
  | { name: string; state: "unreadable" };
export type IntegrityRecords = {
  state: "missing" | "readable" | "unreadable";
  records: AuditRecord[];
  unrecognizedEntries: number;
};
function budget() {
  let remaining = 10000;
  return () => {
    if (--remaining < 0)
      throw Error(
        "Integrity report exceeds its entry limit. No report was exported.",
      );
  };
}
export async function inspectIntegrityRecords(
  root: string,
  take = budget(),
): Promise<IntegrityRecords> {
  const result: IntegrityRecords = {
    state: "readable",
    records: [],
    unrecognizedEntries: 0,
  };
  try {
    if (!(await integrityDirectory(root)))
      return { ...result, state: "missing" };
  } catch {
    return { ...result, state: "unreadable" };
  }
  let directory;
  try {
    directory = await opendir(root);
  } catch {
    return { ...result, state: "unreadable" };
  }
  for await (const entry of directory) {
    take();
    const match = eventName.exec(entry.name);
    if (
      entry.name !== "lockdown.json" &&
      entry.name !== "repair.json" &&
      !match
    ) {
      result.unrecognizedEntries++;
      continue;
    }
    try {
      if (!entry.isFile() || entry.isSymbolicLink())
        throw Error("Invalid record.");
      const raw = await readIntegrityFile(resolve(root, entry.name));
      let value: RecordValue;
      if (entry.name === "lockdown.json") value = parseIntegrityIncident(raw);
      else if (entry.name === "repair.json") value = parseIntegrityRepair(raw);
      else {
        const event = parseIntegrityEvent(raw);
        if (
          event.incident.id !== integrityId(match![1]) ||
          event.event !== match![2]
        )
          throw Error("Mismatched record.");
        value = event;
      }
      result.records.push({ name: entry.name, state: "readable", value });
    } catch {
      result.state = "unreadable";
      result.records.push({ name: entry.name, state: "unreadable" });
    }
  }
  result.records.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
/** Only validated metadata is exported. Corrupt bytes and unknown filenames stay local. */
export async function inspectIntegrity(
  profile: string,
  installation: IntegrityFailure | undefined,
) {
  const take = budget();
  const active = await inspectIntegrityRecords(
    resolve(profile, "integrity"),
    take,
  );
  let pending:
    | { state: "none" | "unreadable" }
    | { state: "readable"; value: IntegrityRepair } = { state: "none" };
  if (await integrityRepairPending(profile)) {
    try {
      pending = {
        state: "readable",
        value: parseIntegrityRepair(
          await readIntegrityFile(resolve(profile, repairFile)),
        ),
      };
    } catch {
      pending = { state: "unreadable" };
    }
  }
  const retained: { name: string; audit: IntegrityRecords }[] = [];
  // A missing profile has no records; do not create it during inspection.
  if (await integrityDirectory(profile)) {
    for await (const entry of await opendir(profile)) {
      take();
      const match = retainedName.exec(entry.name);
      if (!match) continue;
      try {
        integrityId(match[1]);
      } catch {
        continue;
      }
      retained.push({
        name: entry.name,
        audit: await inspectIntegrityRecords(
          resolve(profile, entry.name),
          take,
        ),
      });
    }
  }
  retained.sort((a, b) => a.name.localeCompare(b.name));
  const staged =
    pending.state === "readable"
      ? await inspectIntegrityRecords(
          resolve(profile, `integrity-staged-${pending.value.id}`),
          take,
        )
      : undefined;
  return {
    version: 1 as const,
    kind: "integrity-report" as const,
    at: new Date().toISOString(),
    installation: installation
      ? { state: "failed" as const, failure: installation }
      : { state: "verified" as const },
    active,
    pending,
    retained,
    ...(staged ? { staged } : {}),
  };
}
export async function exportIntegrityReport(
  profile: string,
  destination: string,
  report: Awaited<ReturnType<typeof inspectIntegrity>>,
) {
  if (!isAbsolute(destination)) throw Error("Choose an absolute report path.");
  const parent = await realpath(dirname(destination));
  const profilePath = await realpath(profile);
  const path = resolve(parent, basename(destination));
  const inside = relative(profilePath, path);
  if (
    !inside ||
    (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
  )
    throw Error("Save the report outside application data.");
  const temporary = resolve(parent, `.integrity-report-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(report, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    // Hard-link publication refuses an existing file, including a symlink.
    await link(temporary, path);
    await syncIntegrityDirectory(parent);
  } finally {
    await rm(temporary, { force: true });
  }
}
