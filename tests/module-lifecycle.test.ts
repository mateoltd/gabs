import "dotenv/config";
import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { SuiteClient, type Transport } from "../packages/api-client/src";
import {
  operationPath,
  type OperationRequest,
} from "../packages/contracts/src";
import { defineModule, resource, field, Type } from "@suite/module-sdk";
import type { FeatureProps, Platform } from "../packages/platform/src";
import {
  readModuleStorage,
  changeModuleStorage,
  type ModuleStorage,
} from "../packages/platform/src/module-storage";
import {
  installModule,
  flushInstallationReports,
  uninstallModule,
  verifiedInstalledModule,
} from "../packages/app-web/src/module-installation";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../packages/server-core/src";
import { createApp } from "../apps/api/src/app";
import { signPackage } from "../packages/module-sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  publishRelease,
} from "../tooling/registry-review";

it("recovers exact device changes across download interruption, uncertain acceptance and failed local commits without reviving removed modules", async () => {
  const db = connectDatabase(),
    admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const base = `lifecycle-${randomUUID().slice(0, 8)}`,
    dependency = `${base}-base`,
    root = `${base}-app`,
    workspaceId = randomUUID();
  const locks = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: async (key: string, fn: () => Promise<unknown>) => {
        const previous = locks.get(key) ?? Promise.resolve();
        const next = previous.catch(() => {}).then(fn);
        locks.set(key, next);
        return next;
      },
    },
  });
  const local = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => local.set(key, value),
  });
  const memory = new Map<string, unknown>();
  let failLocalCommit = false;
  const platform: Platform = {
    kind: "web",
    load: async <T>(
      scope: { userId: string; workspaceId: string },
      key: string,
    ) =>
      structuredClone(
        memory.get(`${scope.userId}/${scope.workspaceId}/${key}`),
      ) as T | undefined,
    save: async (scope, key, value) => {
      const data = value as ModuleStorage;
      if (
        key === "module-state" &&
        failLocalCommit &&
        !data.lifecycle?.[root] &&
        data.installed[root]?.version === "1.1.0"
      ) {
        failLocalCommit = false;
        throw Error("Disk write interrupted");
      }
      memory.set(
        `${scope.userId}/${scope.workspaceId}/${key}`,
        structuredClone(value),
      );
    },
    pruneModuleArtifacts: async (scope, keep) => {
      const prefix = `${scope.userId}/${scope.workspaceId}/`;
      for (const key of memory.keys())
        if (
          key.startsWith(prefix + "module-artifact/") &&
          !keep.some((k) => key === prefix + k)
        )
          memory.delete(key);
    },
    purgeWorkspace: async () => {},
    purgeUser: async () => {},
    identity: async () => undefined,
    rememberIdentity: async () => {},
    saveFile: async () => {},
    notify: async () => {},
  };
  const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
  const privateKey = await readFile(`${keys}/private.pem`, "utf8"),
    publicKey = await readFile(`${keys}/public.pem`, "utf8");
  const publish = async (
    id: string,
    version: string,
    dependencies: Record<string, string>,
  ) => {
    const module = defineModule({
      id,
      name: id,
      version,
      dependencies,
      publisher: "suite",
      host: "^1.0.0",
      backend: "^1.0.0",
      description: "Lifecycle acceptance",
      permissions: [`${id}.notes.read`, `${id}.notes.write`],
      configuration: Type.Object({}),
      operations: {},
      resources: {
        notes: resource({ name: field.text() }, { title: "Notes" }),
      },
    });
    const pkg = signPackage(module, privateKey);
    const submission = await submitRelease(admin, pkg, null, publicKey);
    await reviewRelease(
      admin,
      submission,
      "approved",
      "Reviewed lifecycle fixture",
      publicKey,
    );
    await publishRelease(admin, submission, publicKey);
  };
  let server: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    await publish(dependency, "1.0.0", {});
    await publish(root, "1.0.0", { [dependency]: "^1.0.0" });
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      name: "Lifecycle operator",
      email: `${randomUUID()}@test.local`,
      emailVerified: true,
    });
    server = await createApp({
      db,
      auth: {
        mode: "development",
        origin: "http://localhost:4300",
        apiOrigin: "http://localhost:4310",
        mfaClaim: "mfa",
      },
    });
    await inWorkspace(db, workspaceId, (tx) =>
      provisionWorkspace(tx, {
        id: workspaceId,
        userId: user.id,
        name: "Lifecycle",
        modules: [dependency, root],
        kind: "company",
      }),
    );
    const session = await server.auth.issue(user.id, true);
    const sent: OperationRequest[] = [];
    let failDownload = false,
      loseResponse = false,
      corruptDownload = false,
      changePolicy = false,
      failReports = false;
    const transport: Transport = async (request) => {
      sent.push(structuredClone(request));
      if (request.operation === "installationReport" && failReports)
        throw Error("Report connection interrupted");
      if (
        request.operation === "moduleArtifact" &&
        request.params?.moduleId === root &&
        failDownload
      ) {
        failDownload = false;
        throw Error("Download interrupted");
      }
      if (
        request.operation === "platformCommand" &&
        (request.body as { action: string }).action === "install" &&
        changePolicy
      ) {
        changePolicy = false;
        await admin.query(
          "insert into suite.platform_settings(workspace_id,key,value) values($1,$2,$3) on conflict(workspace_id,key) do update set value=$3",
          [workspaceId, `pin:${root}`, { version: "1.0.0" }],
        );
      }
      const path = operationPath(request);
      const response = await server!.app.inject({
        method: path.method,
        url: path.path,
        headers: {
          cookie: `suite_session=${session.token}`,
          origin: "http://localhost:4300",
          "x-csrf-token": session.csrfToken,
          ...(request.idempotencyKey
            ? { "idempotency-key": request.idempotencyKey }
            : {}),
        },
        ...(request.body === undefined
          ? {}
          : {
              payload: JSON.stringify(request.body),
              headers: {
                cookie: `suite_session=${session.token}`,
                origin: "http://localhost:4300",
                "x-csrf-token": session.csrfToken,
                "content-type": "application/json",
                ...(request.idempotencyKey
                  ? { "idempotency-key": request.idempotencyKey }
                  : {}),
              },
            }),
      });
      if (
        loseResponse &&
        request.operation === "platformCommand" &&
        response.statusCode === 200
      ) {
        loseResponse = false;
        throw Error("Response lost after commit");
      }
      const body = response.json();
      if (
        corruptDownload &&
        request.operation === "moduleArtifact" &&
        request.params?.moduleId === root
      ) {
        corruptDownload = false;
        body.artifact.description = "Tampered";
      }
      return { status: response.statusCode, body };
    };
    const client = new SuiteClient(transport);
    const props: FeatureProps = {
      client,
      platform,
      scope: { userId: user.id, workspaceId },
      bootstrap: await client.request({
        operation: "bootstrap",
        params: { workspaceId },
      }),
      online: true,
      offlineEnabled: true,
      onError: () => {},
    };
    const state = () =>
      client.request({ operation: "platformState", params: { workspaceId } });
    const stored = () => readModuleStorage(platform, props.scope);
    const auditCount = async (action: string) =>
      Number(
        (
          await admin.query(
            "select count(*) from suite.audit where workspace_id=$1 and target_id=$2 and action=$3",
            [workspaceId, root, `modules.${action}`],
          )
        ).rows[0].count,
      );
    const fleet = () =>
      client.request({
        operation: "moduleFleet",
        params: { workspaceId, moduleId: root },
      });
    // A mismatched workspace dependency selection is rejected before download,
    // but still leaves a scoped observation with no invented release version.
    const beforeBadPin = await state();
    await admin.query(
      "insert into suite.platform_settings(workspace_id,key,value) values($1,$2,$3) on conflict(workspace_id,key) do update set value=$3",
      [workspaceId, `pin:${dependency}`, { version: "99.0.0" }],
    );
    await expect(installModule(props, beforeBadPin, root)).rejects.toThrow();
    expect((await stored()).lifecycle?.[root]).toBeUndefined();
    const failedPlanId = (await stored()).installationReports?.[root]?.report
      .attemptId;
    await expect(installModule(props, beforeBadPin, root)).rejects.toThrow();
    expect((await stored()).installationReports?.[root]?.report.attemptId).toBe(
      failedPlanId,
    );
    expect((await stored()).installationReports?.[root]).toMatchObject({
      delivered: true,
      report: { errorCode: "policy", phase: "failed" },
    });
    await admin.query(
      "delete from suite.platform_settings where workspace_id=$1 and key=$2",
      [workspaceId, `pin:${dependency}`],
    );
    expect(await fleet()).toMatchObject({
      accepted: 0,
      failed: 1,
      items: [{ reportVersion: null, errorCode: "policy", phase: "failed" }],
    });
    const initial = await state();
    loseResponse = true;
    await expect(installModule(props, initial, dependency)).rejects.toThrow(
      "Response lost after commit",
    );
    const dependencyAttempt = (await stored()).lifecycle![dependency].requestId;
    const dependencyAcceptedAt = (await state()).installations.find(
      (i) => i.module_id === dependency,
    )!.updated_at;
    await Promise.all([
      installModule(props, initial, root),
      installModule(props, initial, root),
    ]);
    expect(await auditCount("install")).toBe(1);
    expect(
      (await state()).installations.find((i) => i.module_id === dependency)!
        .updated_at,
    ).toBe(dependencyAcceptedAt);
    // Another module may accept this same dependency while its original reply is uncertain.
    await installModule(props, await state(), dependency);
    expect((await stored()).lifecycle?.[dependency]).toBeUndefined();
    expect(
      sent.filter(
        (r) =>
          r.operation === "platformCommand" &&
          r.idempotencyKey === dependencyAttempt,
      ),
    ).toHaveLength(2);
    expect((await stored()).installed[root].version).toBe("1.0.0");
    await changeModuleStorage(platform, props.scope, (s) => {
      s.drafts[`${root}:notes`] = { name: "Unsynced work" };
    });
    await publish(dependency, "1.1.0", {});
    await publish(root, "1.1.0", { [dependency]: "^1.0.0" });
    const upgrade = await state();
    failDownload = true;
    await expect(installModule(props, upgrade, root)).rejects.toThrow(
      "Download interrupted",
    );
    expect(await fleet()).toMatchObject({
      total: 1,
      accepted: 0,
      failed: 1,
      items: [{ phase: "failed", version: "1.0.0", reportVersion: "1.1.0" }],
    });
    const pending = (await stored()).lifecycle![root];
    expect((await stored()).downloads?.[`${dependency}@1.1.0`]).toBeTruthy();
    expect((await stored()).installed[root].version).toBe("1.0.0");
    const dependencyDownloads = () =>
      sent.filter(
        (r) =>
          r.operation === "moduleArtifact" && r.params?.moduleId === dependency,
      ).length;
    const beforeResume = dependencyDownloads();
    loseResponse = true;
    await expect(installModule({ ...props }, upgrade, root)).rejects.toThrow(
      "Response lost after commit",
    );
    expect(dependencyDownloads()).toBe(beforeResume);
    expect((await stored()).lifecycle![root].requestId).toBe(pending.requestId);
    expect((await stored()).installed[root].version).toBe("1.0.0");
    expect(await auditCount("install")).toBe(2);
    failLocalCommit = true;
    await expect(installModule({ ...props }, upgrade, root)).rejects.toThrow(
      "Disk write interrupted",
    );
    expect((await stored()).lifecycle![root].requestId).toBe(pending.requestId);
    expect(await fleet()).toMatchObject({
      accepted: 1,
      failed: 1,
      items: [{ phase: "failed", version: "1.1.0" }],
    });
    failReports = true;
    await installModule({ ...props }, upgrade, root);
    expect((await stored()).installationReports?.[root]).toMatchObject({
      delivered: false,
      report: { phase: "ready" },
    });
    failReports = false;
    // A fresh page still respects the persisted delivery delay.
    await flushInstallationReports({ ...props });
    expect((await stored()).installationReports?.[root]?.delivered).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await flushInstallationReports(props);
    expect(await fleet()).toMatchObject({
      accepted: 1,
      failed: 0,
      items: [{ phase: "ready", receiptMatches: true }],
    });
    expect((await stored()).installationReports?.[root]?.delivered).toBe(true);
    expect(await auditCount("install")).toBe(2);
    expect((await stored()).lifecycle?.[root]).toBeUndefined();
    expect((await stored()).installed[root].version).toBe("1.1.0");
    expect(
      await verifiedInstalledModule(props, await stored(), root, await state()),
    ).toBeTruthy();
    corruptDownload = true;
    await expect(
      installModule(props, await state(), root, true),
    ).rejects.toThrow("checksum");
    expect((await stored()).installed[root].version).toBe("1.1.0");
    await installModule(props, await state(), root, true);
    expect(
      await verifiedInstalledModule(props, await stored(), root),
    ).toBeTruthy();
    changePolicy = true;
    await expect(
      installModule(props, await state(), root, true),
    ).rejects.toMatchObject({ code: "INSTALLATION_POLICY_CHANGED" });
    expect((await stored()).lifecycle?.[root]).toBeUndefined();
    await installModule(props, await state(), root);
    expect((await stored()).installed[root].version).toBe("1.0.0");
    const previousInstall = sent
      .filter(
        (r) =>
          r.operation === "platformCommand" &&
          (r.body as { action: string }).action === "install",
      )
      .at(-1)!;
    const installs = await auditCount("install");
    await admin.query(
      "update suite.module_activations set state='suspended' where workspace_id=$1 and module_id=$2",
      [workspaceId, root],
    );
    await expect(client.request(previousInstall)).rejects.toMatchObject({
      code: "MODULE_UNAVAILABLE",
    });
    await admin.query(
      "update suite.module_activations set state='enabled' where workspace_id=$1 and module_id=$2",
      [workspaceId, root],
    );
    await expect(uninstallModule(props, dependency)).rejects.toMatchObject({
      code: "DEPENDENTS_INSTALLED",
    });
    loseResponse = true;
    await expect(uninstallModule(props, root)).rejects.toThrow(
      "Response lost after commit",
    );
    expect(await verifiedInstalledModule(props, await stored(), root)).toBe(
      false,
    );
    const removalId = (await stored()).lifecycle![root].requestId;
    await Promise.all([
      uninstallModule({ ...props }, root, removalId),
      uninstallModule({ ...props }, root, removalId),
    ]);
    expect(await auditCount("uninstall")).toBe(1);
    expect(await fleet()).toMatchObject({
      accepted: 0,
      failed: 0,
      items: [
        {
          phase: "removed",
          reportAction: "uninstall",
          state: "removed",
          receiptMatches: true,
        },
      ],
    });
    const installsAfterRemoval = await auditCount("install");
    expect(
      await installModule(
        props,
        initial,
        root,
        false,
        () => true,
        "background",
      ),
    ).toBe(false);
    expect(await auditCount("install")).toBe(installsAfterRemoval);
    expect(
      (await readModuleStorage(props.platform, props.scope)).lifecycle?.[root],
    ).toBeUndefined();
    expect((await stored()).installed[root]).toBeUndefined();
    expect((await stored()).drafts[`${root}:notes`]).toEqual({
      name: "Unsynced work",
    });
    await expect(client.request(previousInstall)).rejects.toMatchObject({
      code: "INSTALLATION_SUPERSEDED",
    });
    expect(await auditCount("install")).toBe(installs);
    await installModule(props, await state(), root);
    expect((await stored()).drafts[`${root}:notes`]).toEqual({
      name: "Unsynced work",
    });
    const previousRemoval = sent
      .filter(
        (r) =>
          r.operation === "platformCommand" &&
          (r.body as { action: string; value: { moduleId: string } }).action ===
            "uninstall" &&
          (r.body as { value: { moduleId: string } }).value.moduleId === root,
      )
      .at(-1)!;
    await expect(client.request(previousRemoval)).rejects.toMatchObject({
      code: "INSTALLATION_SUPERSEDED",
    });
    expect(
      (await state()).installations.find((r) => r.module_id === root)?.state,
    ).toBe("installed");
    // A newly published dependency-free version does not erase an installed older version's dependency.
    await publish(root, "3.0.0", {});
    await admin.query(
      "update suite.platform_settings set value=$3 where workspace_id=$1 and key=$2",
      [workspaceId, `pin:${root}`, { version: "3.0.0" }],
    );
    await expect(uninstallModule(props, dependency)).rejects.toMatchObject({
      code: "DEPENDENTS_INSTALLED",
    });
    await installModule(props, await state(), root);
    await uninstallModule(props, dependency);
    expect(
      await verifiedInstalledModule(props, await stored(), root, await state()),
    ).toBeTruthy();
  } finally {
    await server?.app.close();
    await db.destroy();
    for (const id of [root, dependency]) {
      await admin.query(
        "delete from suite.module_releases where module_id=$1",
        [id],
      );
      await admin.query(
        "delete from suite.module_review_events where submission_id in (select id from suite.module_submissions where module_id=$1)",
        [id],
      );
      await admin.query(
        "delete from suite.module_submissions where module_id=$1",
        [id],
      );
    }
    await admin.end();
    vi.unstubAllGlobals();
  }
}, 30000);
