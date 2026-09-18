import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { downloadExport } from "../../apps/desktop/src/main/export-download";
import { ModuleHostSessions } from "../../apps/desktop/src/main/module-capabilities";
const scope = { userId: randomUUID(), workspaceId: randomUUID() };
it("checks readiness before the dialog and retrieves server-owned bytes only after current authorization", async () => {
  const id = randomUUID(),
    filename = `orders-${id}.csv`;
  const calls: string[] = [];
  let denied = false;
  const run = (revoke = false, cancel = false) =>
    downloadExport(scope, id, {
      check: () => {},
      request: async (request) => {
        calls.push(request.operation);
        expect(request.params).toEqual({ workspaceId: scope.workspaceId, id });
        return denied
          ? { status: 403, body: { message: "Permission revoked" } }
          : {
              status: 200,
              body:
                request.operation === "exportAuthorize"
                  ? { filename }
                  : { filename, content: "Server CSV" },
            };
      },
      choose: async () => {
        calls.push("dialog");
        denied = revoke;
        return cancel ? undefined : "/chosen/path.csv";
      },
      write: async (path, content) => {
        expect(path).toBe("/chosen/path.csv");
        expect(content).toBe("Server CSV");
        calls.push("write");
      },
    });
  await expect(run()).resolves.toEqual({ status: "saved" });
  expect(calls).toEqual([
    "exportAuthorize",
    "dialog",
    "exportDownload",
    "write",
  ]);
  calls.length = 0;
  await expect(run(true)).rejects.toThrow("Permission revoked");
  expect(calls).toEqual(["exportAuthorize", "dialog", "exportDownload"]);
  denied = false;
  calls.length = 0;
  await expect(run(false, true)).resolves.toEqual({ status: "cancelled" });
  expect(calls).toEqual(["exportAuthorize", "dialog"]);
});
it("rejects stale module sessions and mismatched server filenames before writing", async () => {
  const id = randomUUID(),
    filename = `orders-${id}.csv`;
  const sessions = new ModuleHostSessions(() => scope.userId);
  const handle = sessions.open(scope, "orders", "2.0.0");
  const context = sessions.capture(handle);
  let writes = 0;
  await expect(
    downloadExport(scope, id, {
      check: () => {
        context.check();
      },
      request: async () => ({ status: 200, body: { filename } }),
      choose: async () => {
        sessions.close(handle);
        return "/chosen/path.csv";
      },
      write: async () => {
        writes++;
      },
    }),
  ).rejects.toThrow("session is no longer active");
  await expect(
    downloadExport(scope, id, {
      check: () => {},
      request: async (request) => ({
        status: 200,
        body:
          request.operation === "exportAuthorize"
            ? { filename }
            : { filename: "another.csv", content: "Wrong identity" },
      }),
      choose: async () => "/chosen/path.csv",
      write: async () => {
        writes++;
      },
    }),
  ).rejects.toThrow("identity changed");
  expect(writes).toBe(0);
});
