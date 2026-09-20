import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { IntegrityFailure } from "./format";
import { parseIntegrityIncident, parseIntegrityEvent, type IntegrityIncident as Incident, type IntegrityEvent as Event } from "./format";
import { ensureIntegrityDirectory, readIntegrityFile as read, writeIntegrityFile, syncIntegrityDirectory as syncDirectory } from "./files";

/** Local operational evidence only. An OS administrator can alter these records. */
export class IntegrityJournal {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly root: string,
    private readonly release: string,
  ) {}
  private replace(name: string, value: unknown) { return writeIntegrityFile(this.root, name, value); }
  private async event(kind: Event["event"], original: Incident) {
    const name = `${original.id}.${kind}.json`;
    const saved = await read(resolve(this.root, name));
    const previous = saved === undefined ? undefined : parseIntegrityEvent(saved);
    if (previous !== undefined) {
      if (
        previous.event !== kind ||
        JSON.stringify(previous.incident) !==
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
        await ensureIntegrityDirectory(this.root);
        const state = await read(resolve(this.root, "lockdown.json"));
        let original = state === undefined ? undefined : parseIntegrityIncident(state);
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
