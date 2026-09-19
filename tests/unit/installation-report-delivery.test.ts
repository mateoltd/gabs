import { afterEach, expect, it, vi } from "vitest";
import { SuiteClient, type Transport } from "../../packages/client/src/api";
import type { Platform } from "../../packages/client/src";
import {
  changeModuleStorage,
  readModuleStorage,
} from "../../packages/client/src/modules/storage";
import {
  flushInstallationReports,
  reportInstallation,
} from "../../packages/shell/src/features/administration/installation-reporting";

function fixture(transport: Transport) {
  vi.useFakeTimers();
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (key: string, fn: () => Promise<unknown>) => {
        const next = (locks.get(key) ?? Promise.resolve())
          .catch(() => {})
          .then(fn);
        locks.set(key, next);
        return next;
      },
    },
  });
  const memory = new Map<string, unknown>();
  const platform: Platform = {
    accountRevision: async () => "initial",
    kind: "web",
    load: async <T>(
      scope: { userId: string; workspaceId: string },
      key: string,
    ) =>
      structuredClone(
        memory.get(`${scope.userId}/${scope.workspaceId}/${key}`),
      ) as T | undefined,
    save: async (scope, key, value) => {
      memory.set(
        `${scope.userId}/${scope.workspaceId}/${key}`,
        structuredClone(value),
      );
    },
    pruneModuleArtifacts: async () => {},
    purgeUser: async () => {},
    purgeWorkspace: async () => {},
    identity: async () => undefined,
    rememberIdentity: async () => {},
    saveFile: async () => {},
    notify: async () => {},
  };
  const props = {
    platform,
    scope: { userId: crypto.randomUUID(), workspaceId: crypto.randomUUID() },
    client: new SuiteClient(transport),
  };
  const seed = async (moduleId: string) =>
    changeModuleStorage(platform, props.scope, (s) => {
      (s.installationReports ??= {})[moduleId] = {
        delivered: false,
        report: {
          moduleId,
          deviceId: "test-device",
          attemptId: crypto.randomUUID(),
          sequence: 1,
          phase: "failed",
          errorCode: "connection",
        },
      };
    });
  const read = async () =>
    (await readModuleStorage(platform, props.scope)).installationReports!;
  return { props, seed, read };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("persists report backoff across reload and later phases, and retries authorization after recovery", async () => {
  let status = 503;
  const transport = vi.fn<Transport>(async () => ({ status, body: {} }));
  const { props, seed, read } = fixture(transport);
  await seed("contacts");
  await flushInstallationReports(props);
  expect((await read()).contacts.delivery).toMatchObject({
    attempts: 1,
    nextAttemptAt: Date.now() + 1000,
  });
  await flushInstallationReports({
    ...props,
    client: new SuiteClient(transport),
  });
  expect(transport).toHaveBeenCalledTimes(1);
  const attempt = (await read()).contacts.report;
  await reportInstallation(
    props,
    "contacts",
    {
      action: "install",
      deviceId: attempt.deviceId,
      requestId: attempt.attemptId,
      releases: [],
      startedAt: Date.now(),
      phase: "confirming",
    },
    "confirming",
  );
  expect(transport).toHaveBeenCalledTimes(1);
  status = 401;
  await vi.advanceTimersByTimeAsync(1000);
  await flushInstallationReports(props);
  expect((await read()).contacts.delivery).toMatchObject({
    attempts: 2,
    nextAttemptAt: Date.now() + 2000,
  });
  status = 200;
  await vi.advanceTimersByTimeAsync(2000);
  await flushInstallationReports(props);
  expect((await read()).contacts.delivered).toBe(true);
  expect(transport.mock.calls.at(-1)?.[0].body).toMatchObject({
    accountId: props.scope.userId,
    sequence: 2,
  });
});

it("bounds hung report delivery while unrelated reports complete and ignores a late reply", async () => {
  let settle!: (value: { status: number; body: unknown }) => void;
  const transport = vi.fn<Transport>(async (request) =>
    (request.body as { moduleId: string }).moduleId === "contacts"
      ? new Promise((resolve) => {
          settle = resolve;
        })
      : { status: 200, body: {} },
  );
  const { props, seed, read } = fixture(transport);
  await seed("contacts");
  await seed("projects");
  const flushing = flushInstallationReports(props);
  await vi.advanceTimersByTimeAsync(0);
  expect((await read()).projects.delivered).toBe(true);
  await vi.advanceTimersByTimeAsync(2000);
  await flushing;
  expect((await read()).contacts).toMatchObject({
    delivered: false,
    delivery: { attempts: 1 },
  });
  expect(transport.mock.calls[0][1]?.aborted).toBe(true);
  settle({ status: 200, body: {} });
  await vi.advanceTimersByTimeAsync(0);
  expect((await read()).contacts.delivered).toBe(false);
});

it("stops invalid and superseded reports without mistaking them for delivered observations", async () => {
  const transport = vi.fn<Transport>(async (request) => ({
    status:
      (request.body as { moduleId: string }).moduleId === "contacts"
        ? 409
        : 400,
    body: {},
  }));
  const { props, seed, read } = fixture(transport);
  await seed("contacts");
  await seed("projects");
  await flushInstallationReports(props);
  expect((await read()).contacts).toMatchObject({
    delivered: false,
    delivery: { rejected: "superseded" },
  });
  expect((await read()).projects.delivery?.rejected).toBe("invalid");
  await vi.advanceTimersByTimeAsync(600000);
  await flushInstallationReports(props);
  expect(transport).toHaveBeenCalledTimes(2);
});

it("does not let an obsolete response settle a replacement report and bounds each delivery batch", async () => {
  let settle!: (value: { status: number; body: unknown }) => void;
  const transport = vi.fn<Transport>(async (request) =>
    (request.body as { moduleId: string }).moduleId === "contacts"
      ? new Promise((resolve) => {
          settle = resolve;
        })
      : { status: 200, body: {} },
  );
  const { props, seed, read } = fixture(transport);
  for (const id of ["contacts", "projects", "orders", "inventory", "fifth"])
    await seed(id);
  const flushing = flushInstallationReports(props);
  await vi.advanceTimersByTimeAsync(0);
  await changeModuleStorage(props.platform, props.scope, (s) => {
    s.installationReports!.contacts.report.sequence++;
  });
  settle({ status: 200, body: {} });
  await flushing;
  expect(transport).toHaveBeenCalledTimes(4);
  expect((await read()).contacts).toMatchObject({
    delivered: false,
    report: { sequence: 2 },
  });
  expect((await read()).fifth.delivered).toBe(false);
});
