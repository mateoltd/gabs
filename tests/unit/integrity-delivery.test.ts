import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { IntegrityReport, IntegrityScope } from "@suite/contracts";
import {
  IntegrityDelivery,
  integrityDeviceId,
} from "../../apps/desktop/src/main/integrity/delivery";
import { IntegrityJournal } from "../../apps/desktop/src/main/integrity/journal";
const profiles: string[] = [];
afterEach(async () => {
  await Promise.all(
    profiles
      .splice(0)
      .map((profile) => rm(profile, { recursive: true, force: true })),
  );
});
async function fixture() {
  const profile = await mkdtemp(resolve(tmpdir(), "suite-integrity-delivery-"));
  profiles.push(profile);
  const scope: IntegrityScope = {
    accountId: randomUUID(),
    workspaceId: randomUUID(),
    deviceId: await integrityDeviceId(profile),
  };
  const journal = new IntegrityJournal(
    resolve(profile, "integrity"),
    "1.0.0",
    scope,
  );
  await journal.record({ code: "changed-asset", asset: "preload.cjs" });
  await journal.record();
  return { profile, scope };
}
it("delivers only the captured account/company and retains durable receipts through restart", async () => {
  const { profile, scope } = await fixture();
  expect(await integrityDeviceId(profile)).toBe(scope.deviceId);
  const sent: IntegrityReport[] = [];
  const host = {
    profile: () => profile,
    current: () => true,
    send: async (_scope: IntegrityScope, report: IntegrityReport) => {
      sent.push(report);
      return {
        status: 200,
        body: { id: randomUUID(), receivedAt: new Date().toISOString() },
      };
    },
  };
  await new IntegrityDelivery(host).flush({
    ...scope,
    accountId: randomUUID(),
  });
  await new IntegrityDelivery(host).flush({
    ...scope,
    workspaceId: randomUUID(),
  });
  expect(sent).toHaveLength(0);
  await new IntegrityDelivery(host).flush(scope);
  expect(sent.map((report) => report.event).sort()).toEqual([
    "locked",
    "recovered",
  ]);
  expect(new Set(sent.map((report) => report.incidentId)).size).toBe(1);
  await new IntegrityDelivery(host).flush(scope);
  expect(sent).toHaveLength(2);
});
it("does not acknowledge a late response after a profile transition and retries the original event", async () => {
  const { profile, scope } = await fixture();
  let current = true;
  const sent: IntegrityReport[] = [];
  const receipt = { id: randomUUID(), receivedAt: new Date().toISOString() };
  let release!: (value: { status: number; body: typeof receipt }) => void;
  let observed!: () => void;
  const arrived = new Promise<void>((done) => {
    observed = done;
  });
  const delivery = new IntegrityDelivery({
    profile: () => profile,
    current: () => current,
    send: async (_scope, report) => {
      sent.push(report);
      observed();
      return new Promise((done) => {
        release = done;
      });
    },
  });
  const flight = delivery.flush(scope);
  await arrived;
  current = false;
  release({ status: 200, body: receipt });
  await flight;
  expect(await readdir(profile)).not.toContain("integrity-delivery");
  current = true;
  await new IntegrityDelivery({
    profile: () => profile,
    current: () => current,
    send: async (_scope, report) => {
      sent.push(report);
      return { status: 200, body: receipt };
    },
  }).flush(scope);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent).toHaveLength(3);
});
it("keeps denied or invalid acknowledgements pending without blocking an unrelated event", async () => {
  const { profile, scope } = await fixture();
  const events: string[] = [];
  await new IntegrityDelivery({
    profile: () => profile,
    current: () => true,
    send: async (_scope, report) => {
      events.push(report.event);
      return {
        status: report.event === "locked" ? 409 : 200,
        body: { id: randomUUID(), receivedAt: new Date().toISOString() },
      };
    },
  }).flush(scope);
  expect(events.sort()).toEqual(["locked", "recovered"]);
  events.length = 0;
  await new IntegrityDelivery({
    profile: () => profile,
    current: () => true,
    send: async (_scope, report) => {
      events.push(report.event);
      return { status: 200, body: { ok: true } };
    },
  }).flush(scope);
  expect(events).toEqual(["locked"]);
  expect(await readdir(resolve(profile, "integrity-delivery"))).toHaveLength(1);
});
it("never attributes legacy evidence to the currently connected account", async () => {
  const { profile, scope } = await fixture();
  await rm(resolve(profile, "integrity"), { recursive: true });
  const journal = new IntegrityJournal(resolve(profile, "integrity"), "1.0.0");
  await journal.record({ code: "missing-asset", asset: "preload.cjs" });
  await journal.record();
  let calls = 0;
  await new IntegrityDelivery({
    profile: () => profile,
    current: () => true,
    send: async () => {
      calls++;
      throw Error("Unexpected delivery");
    },
  }).flush(scope);
  expect(calls).toBe(0);
  await writeFile(resolve(profile, "integrity-device.json"), "broken original");
  await expect(integrityDeviceId(profile)).rejects.toThrow();
});

it("advances past a full batch of rejected events so later evidence can be delivered", async () => {
  const { profile, scope } = await fixture();
  const journal = new IntegrityJournal(
    resolve(profile, "integrity"),
    "1.0.0",
    scope,
  );
  for (let index = 0; index < 26; index++) {
    await journal.record({ code: "missing-asset", asset: "preload.cjs" });
    await journal.record();
  }
  const attempted = new Set<string>();
  let calls = 0;
  const delivery = new IntegrityDelivery({
    profile: () => profile,
    current: () => true,
    send: async (_scope, report) => {
      calls++;
      attempted.add(`${report.incidentId}/${report.event}`);
      return { status: 409, body: {} };
    },
  });
  await delivery.flush(scope);
  expect(calls).toBe(50);
  await delivery.flush(scope);
  expect(attempted.size).toBe(54);
  expect(calls).toBeLessThanOrEqual(100);
});
