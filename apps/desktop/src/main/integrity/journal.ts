import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import type { IntegrityFailure } from "./assets";

type Incident = {
  id: string;
  at: string;
  release: string;
  failure: IntegrityFailure;
};
type Event = {
  event: "locked" | "recovered";
  incident: Incident;
  at: string;
  release: string;
};
const codes = new Set([
  "invalid-manifest",
  "unexpected-asset",
  "missing-asset",
  "changed-asset",
  "unreadable-assets",
  "invalid-signature",
]);

async function syncDirectory(path: string) {
  if (process.platform === "win32") return;
  const file = await open(path, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
async function read(path: string): Promise<unknown> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8192)
      throw Error("Invalid integrity record.");
    return JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}
function incident(value: unknown): Incident {
  const item = value as Incident;
  if (
    !item ||
    !/^[a-f0-9-]{36}$/.test(item.id) ||
    typeof item.at !== "string" ||
    !Number.isFinite(Date.parse(item.at)) ||
    typeof item.release !== "string" ||
    item.release.length > 80 ||
    !item.failure ||
    !codes.has(item.failure.code) ||
    (item.failure.asset !== undefined &&
      (typeof item.failure.asset !== "string" ||
        item.failure.asset.length > 512))
  )
    throw Error("Invalid integrity record.");
  return item;
}

/** Local operational evidence only. An OS administrator can alter these records. */
export class IntegrityJournal {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly root: string,
    private readonly release: string,
  ) {}
  private async replace(name: string, value: unknown) {
    const destination = resolve(this.root, name);
    const temporary = resolve(this.root, `${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(value) + "\n");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, destination);
      await syncDirectory(this.root);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  private async event(kind: Event["event"], original: Incident) {
    const name = `${original.id}.${kind}.json`;
    const previous = (await read(resolve(this.root, name))) as
      Event | undefined;
    if (previous !== undefined) {
      if (
        previous.event !== kind ||
        JSON.stringify(incident(previous.incident)) !==
          JSON.stringify(original) ||
        typeof previous.at !== "string" ||
        !Number.isFinite(Date.parse(previous.at)) ||
        typeof previous.release !== "string"
      )
        throw Error("Invalid integrity event.");
      // A prior rename may have succeeded before its directory flush failed.
      await syncDirectory(this.root);
      return;
    }
    await this.replace(name, {
      event: kind,
      incident: original,
      release: this.release,
      at: new Date().toISOString(),
    } satisfies Event);
  }
  record(
    failure?: IntegrityFailure,
    beforeRecovery?: () => Promise<void>,
  ): Promise<void> {
    const task = this.pending
      .catch(() => {})
      .then(async () => {
        const created = await mkdir(this.root, {
          recursive: true,
          mode: 0o700,
        });
        if (created) await syncDirectory(resolve(this.root, ".."));
        const state = await read(resolve(this.root, "lockdown.json"));
        let original = state === undefined ? undefined : incident(state);
        if (failure) {
          if (!original) {
            original = {
              id: randomUUID(),
              at: new Date().toISOString(),
              release: this.release,
              failure: { ...failure },
            };
            await this.replace("lockdown.json", original);
          }
          await this.event("locked", original);
        } else if (original) {
          // Repair an interrupted audit write before acknowledging recovery.
          await this.event("locked", original);
          // Session invalidation must finish before recovery is durable or access opens.
          await beforeRecovery?.();
          await this.event("recovered", original);
          await rm(resolve(this.root, "lockdown.json"));
          await syncDirectory(this.root);
        }
      });
    this.pending = task;
    return task;
  }
}
