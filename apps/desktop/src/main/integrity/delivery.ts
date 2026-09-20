import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { assertSchema } from "@suite/module-sdk";
import {
  IntegrityReceiptSchema,
  type IntegrityReport,
  type IntegrityScope,
} from "@suite/contracts";
import { integrityId } from "./format";
import {
  ensureIntegrityDirectory,
  readIntegrityFile,
  writeIntegrityFile,
} from "./files";
import { inspectIntegrity } from "./report";

export async function integrityDeviceId(profile: string) {
  const value = await readIntegrityFile(
    resolve(profile, "integrity-device.json"),
  );
  if (value !== undefined) return integrityId((value as { id?: unknown }).id);
  const id = randomUUID();
  await writeIntegrityFile(profile, "integrity-device.json", { id });
  return id;
}
export class IntegrityDelivery {
  private flight?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private readonly cursors = new Map<string, string>();
  constructor(
    private readonly host: {
      profile(): string;
      current(scope: IntegrityScope): boolean;
      send(
        scope: IntegrityScope,
        report: IntegrityReport,
      ): Promise<{ status: number; body: unknown }>;
    },
  ) {}
  start(scope: () => IntegrityScope | undefined) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const value = scope();
      if (value) void this.flush(value);
    }, 60000);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  flush(scope: IntegrityScope): Promise<void> {
    if (this.flight) return this.flight;
    const flight = this.deliver(scope).catch(() => {
      process.stderr.write("Integrity diagnostic delivery remains pending.\n");
    });
    this.flight = flight;
    void flight.finally(() => {
      if (this.flight === flight) this.flight = undefined;
    });
    return flight;
  }
  private async deliver(scope: IntegrityScope) {
    if (!this.host.current(scope)) return;
    const profile = this.host.profile();
    const reports = await inspectIntegrity(profile, undefined);
    const candidates = [
      reports.active,
      ...reports.retained.map((value) => value.audit),
    ];
    const pending = new Map<string, IntegrityReport>();
    for (const audit of candidates)
      for (const entry of audit.records) {
        if (entry.state !== "readable" || !("event" in entry.value)) continue;
        const event = entry.value;
        const origin = event.incident.scope;
        if (
          !origin ||
          origin.accountId !== scope.accountId ||
          origin.workspaceId !== scope.workspaceId
        )
          continue;
        const report: IntegrityReport = {
          accountId: origin.accountId,
          deviceId: origin.deviceId,
          incidentId: event.incident.id,
          event: event.event,
          occurredAt: event.at,
          incidentAt: event.incident.at,
          release: event.release,
          incidentRelease: event.incident.release,
          failureCode: event.incident.failure.code,
          ...(event.incident.failure.asset
            ? { asset: event.incident.failure.asset }
            : {}),
        };
        const digest = createHash("sha256")
          .update(JSON.stringify([scope.accountId, scope.workspaceId, report]))
          .digest("hex");
        pending.set(digest, report);
      }
    const root = resolve(profile, "integrity-delivery");
    const scopeKey = JSON.stringify([
      profile,
      scope.accountId,
      scope.workspaceId,
      scope.deviceId,
    ]);
    const entries = [...pending];
    const cursor = this.cursors.get(scopeKey);
    const cursorIndex = cursor
      ? entries.findIndex(([digest]) => digest === cursor)
      : -1;
    const ordered =
      cursorIndex < 0
        ? entries
        : [
            ...entries.slice(cursorIndex + 1),
            ...entries.slice(0, cursorIndex + 1),
          ];
    let attempted = 0;
    for (const [digest, report] of ordered) {
      if (!this.host.current(scope) || attempted >= 50) return;
      const name = `${digest}.receipt.json`;
      try {
        const receipt = await readIntegrityFile(resolve(root, name));
        if (receipt !== undefined) {
          assertSchema(IntegrityReceiptSchema, receipt);
          continue;
        }
      } catch {
        /* Corrupt acknowledgements cannot discard the original event. */
      }
      attempted++;
      let response;
      try {
        response = await this.host.send(scope, report);
      } catch {
        return;
      } // Reconnect will retry the exact event; no new identity is minted.
      if (!this.host.current(scope)) return;
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 426
      )
        return;
      this.cursors.set(scopeKey, digest);
      if (response.status !== 200) continue; // An individually rejected event cannot block others.
      try {
        assertSchema(IntegrityReceiptSchema, response.body);
        await ensureIntegrityDirectory(root);
        if (!this.host.current(scope)) return;
        await writeIntegrityFile(root, name, response.body);
      } catch {
        /* The server result is replayable if local acknowledgement fails. */
      }
    }
  }
}
