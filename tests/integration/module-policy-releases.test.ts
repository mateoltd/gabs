import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { defineModule, Type } from "@suite/module-sdk";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { MemberSchema, Static } from "@suite/contracts";
import { signPackage } from "@suite/module-sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  publishRelease,
} from "../../tooling/modules/registry-review";
import { createApp } from "../../apps/api/src/app";
import { applySubscription } from "../../apps/api/src/billing";
import { productServerRuntime } from "../../composition/src/presets/index";
import {
  connectDatabase,
  identify,
  provisionWorkspace,
  inWorkspace,
  checkModule,
} from "../../composition/src/server/product";

it("adopts signed dependency changes once, preserves pins/direct grants and recovers unavailable seats", async () => {
  const db = connectDatabase(),
    admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const registry = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    options: "-c role=suite_registry",
  });
  const worker = new Pool({
    connectionString:
      process.env.WORKER_DATABASE_URL ??
      process.env.DATABASE_URL?.replace("suite_app:", "suite_worker:"),
  });
  const auth = {
    mode: "development" as const,
    origin: "http://localhost:4300",
    apiOrigin: "http://localhost:4310",
    mfaClaim: "mfa",
  };
  let server = await createApp({ db, auth });
  const workspace = randomUUID(),
    id = `policy-${randomUUID().slice(0, 8)}`;
  const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
  const privateKey = await readFile(`${keys}/private.pem`, "utf8"),
    publicKey = await readFile(`${keys}/public.pem`, "utf8");
  const publish = async (
    version: string,
    dependencies: Record<string, string>,
  ) => {
    const pkg = signPackage(
      defineModule({
        id,
        name: "Policy releases",
        version,
        description: "Dependency policy acceptance",
        host: "^1.0.0",
        backend: "^1.0.0",
        publisher: "suite",
        dependencies,
        permissions: [],
        configuration: Type.Object({}),
        resources: {},
        operations: {},
      }),
      privateKey,
    );
    const submitted = await submitRelease(registry, pkg, null, publicKey);
    await reviewRelease(
      registry,
      submitted,
      "approved",
      "Exact dependency policy fixture reviewed",
      publicKey,
    );
    await publishRelease(registry, submitted, publicKey);
    return submitted;
  };
  try {
    await publish("1.0.0", { contacts: "^1.0.0" });
    const owner = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Release owner",
      emailVerified: true,
    });
    await inWorkspace(db, workspace, (tx) =>
      provisionWorkspace(tx, {
        id: workspace,
        userId: owner.id,
        kind: "company",
        name: "Release policies",
      }),
    );
    const session = await server.auth.issue(owner.id, true);
    const headers = {
      cookie: `suite_session=${session.token}`,
      origin: auth.origin,
      "x-csrf-token": session.csrfToken,
    };
    const state = async () =>
      (
        await server.app.inject({
          method: "GET",
          url: `/api/v1/workspaces/${workspace}/platform`,
          headers,
        })
      ).json<PlatformState>();
    const members = async () =>
      (
        await server.app.inject({
          method: "GET",
          url: `/api/v1/workspaces/${workspace}/members`,
          headers,
        })
      ).json<Static<typeof MemberSchema>[]>();
    const initial = await state(),
      sales = initial.roles.find((r) => r.name === "Sales")!.id,
      warehouse = initial.roles.find((r) => r.name === "Warehouse")!.id;
    const people = [] as {
      id: string;
      userId: string;
      headers: Record<string, string>;
    }[];
    for (let index = 0; index < 2; index++) {
      const user = await identify(db, {
        issuer: "test",
        subject: randomUUID(),
        email: `${randomUUID()}@test.local`,
        name: `Member ${index}`,
        emailVerified: true,
      });
      const member = randomUUID();
      await admin.query(
        "insert into suite.memberships(id,workspace_id,user_id,created_at) values($1,$2,$3,now()+($4::int*interval '1 second'))",
        [member, workspace, user.id, index],
      );
      await admin.query(
        "insert into suite.role_assignments(workspace_id,membership_id,role_id) values($1,$2,$3)",
        [workspace, member, sales],
      );
      const s = await server.auth.issue(user.id, true);
      people.push({
        id: member,
        userId: user.id,
        headers: { cookie: `suite_session=${s.token}` },
      });
    }
    const directUser = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Direct applicant",
      emailVerified: true,
    });
    const directApplicant = randomUUID();
    await admin.query(
      "insert into suite.memberships(id,workspace_id,user_id) values($1,$2,$3)",
      [directApplicant, workspace, directUser.id],
    );
    await admin.query(
      "insert into suite.role_assignments(workspace_id,membership_id,role_id) values($1,$2,$3)",
      [workspace, directApplicant, warehouse],
    );
    const rows = async (member: string) =>
      (
        await admin.query<{ module_id: string; direct: boolean }>(
          "select module_id,direct from suite.module_assignments where workspace_id=$1 and membership_id=$2 order by module_id",
          [workspace, member],
        )
      ).rows;
    await admin.query(
      "insert into suite.module_assignments(workspace_id,membership_id,module_id) values($1,$2,'contacts')",
      [workspace, people[1].id],
    );
    await admin.query(
      "insert into suite.entitlements(workspace_id,module_id) values($1,$2)",
      [workspace, id],
    );
    const enable = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/workspaces/${workspace}/modules/${id}`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { state: "enabled", accessPolicy: "admin" },
    });
    expect(enable.statusCode, enable.body).toBe(200);
    const { version, ...policy } = initial.organization!;
    policy.tags = [
      {
        id: randomUUID(),
        name: "Release team",
        rankIds: [sales],
        grants: [],
        denies: [],
        modules: [id],
      },
    ];
    const saved = await server.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspace}/platform`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { action: "organization", value: policy, version },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const bootstrap = async (index = 0) =>
      server.app.inject({
        method: "GET",
        url: `/api/v1/workspaces/${workspace}/bootstrap`,
        headers: people[index].headers,
      });
    expect((await bootstrap()).statusCode).toBe(200);
    expect((await rows(people[0].id)).map((r) => r.module_id)).toEqual(
      ["contacts", id].sort(),
    );
    const revision = async () =>
      (await admin.query("select revision from suite.registry_revision"))
        .rows[0].revision as string;
    const submission = await publish("1.1.0", {});
    const afterPublish = await revision();
    await publishRelease(registry, submission, publicKey);
    expect(await revision()).toBe(afterPublish);
    // Before reconciliation, both the read model and execution reject the obsolete row.
    expect(
      (await members()).find((m) => m.id === people[0].id)!.modules,
    ).toEqual([id]);
    await expect(
      inWorkspace(db, workspace, (tx) =>
        checkModule(tx, workspace, people[0].id, "contacts"),
      ),
    ).rejects.toMatchObject({ code: "MODULE_NOT_ASSIGNED" });
    await server.app.close();
    server = await createApp({ db, auth });
    expect(
      (await Promise.all([bootstrap(), bootstrap(1), bootstrap()])).map(
        (r) => r.statusCode,
      ),
    ).toEqual([200, 200, 200]);
    expect(await rows(people[0].id)).toEqual([
      { module_id: id, direct: false },
    ]);
    expect(await rows(people[1].id)).toEqual(
      [
        { module_id: "contacts", direct: true },
        { module_id: id, direct: false },
      ].sort((a, b) => a.module_id.localeCompare(b.module_id)),
    );
    const audit = async () =>
      (
        await admin.query(
          "select count(*)::int n from suite.audit where workspace_id=$1 and action='modules.policy_refreshed'",
          [workspace],
        )
      ).rows[0].n;
    expect(await audit()).toBe(1);
    expect((await bootstrap()).statusCode).toBe(200);
    expect(await audit()).toBe(1);
    // Recreate the obsolete derived dependency after proving refresh exactly once.
    // Seat admission must ignore it because the current signed root no longer uses it.
    await admin.query(
      "insert into suite.module_assignments(workspace_id,membership_id,module_id,direct) values($1,$2,'contacts',false)",
      [workspace, people[0].id],
    );
    const directSeats = Number(
      (
        await admin.query(
          "select count(*)::int n from suite.module_assignments a join suite.memberships m on m.workspace_id=a.workspace_id and m.id=a.membership_id where a.workspace_id=$1 and a.module_id='contacts' and a.direct and m.active",
          [workspace],
        )
      ).rows[0].n,
    );
    await admin.query(
      "update suite.entitlements set seat_limit=$2 where workspace_id=$1 and module_id='contacts'",
      [workspace, directSeats + 1],
    );
    const directAdmission = await server.app.inject({
      method: "PATCH",
      url: `/api/v1/workspaces/${workspace}/members/${directApplicant}`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: {
        revision: (await members()).find((item) => item.id === directApplicant)!
          .revision,
        active: true,
        roleIds: [warehouse],
        modules: ["contacts"],
        directModules: ["contacts"],
      },
    });
    expect(directAdmission.statusCode, directAdmission.body).toBe(200);
    expect(await rows(directApplicant)).toEqual([
      { module_id: "contacts", direct: true },
    ]);
    await admin.query(
      "update suite.entitlements set seat_limit=null where workspace_id=$1 and module_id='contacts'",
      [workspace],
    );
    // New dependencies require actual capacity. One pending member must not block another.
    await admin.query(
      "update suite.entitlements set seat_limit=2 where workspace_id=$1 and module_id='inventory'",
      [workspace],
    );
    await publish("1.2.0", { inventory: "^2.0.0" });
    const refreshed = await server.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${workspace}/policy?since=0`,
      headers: people[0].headers,
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect((await rows(people[0].id)).map((r) => r.module_id)).toEqual(
      [id, "inventory"].sort(),
    );
    expect(await rows(people[1].id)).toEqual([
      { module_id: "contacts", direct: true },
    ]);
    expect(
      (await members())
        .find((m) => m.id === people[1].id)!
        .modulePolicies?.find((p) => p.moduleId === id)?.assigned,
    ).toBe(false);
    const edit = async (
      index: number,
      roleIds: string[],
      directModules: string[],
    ) =>
      server.app.inject({
        method: "PATCH",
        url: `/api/v1/workspaces/${workspace}/members/${people[index].id}`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: {
          revision: (await members()).find(
            (item) => item.id === people[index].id,
          )!.revision,
          active: true,
          roleIds,
          modules: directModules,
          directModules,
        },
      });
    const unchanged = await edit(1, [sales], ["contacts"]);
    expect(unchanged.statusCode, unchanged.body).toBe(200);
    // Existing pending intent must not prevent an unrelated policy-name edit.
    const current = (await state()).organization!;
    const { version: currentVersion, ...renamed } = current;
    renamed.tags![0].name = "Release staff";
    const rename = await server.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspace}/platform`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: {
        action: "organization",
        value: renamed,
        version: currentVersion,
      },
    });
    expect(rename.statusCode, rename.body).toBe(200);
    expect((await edit(1, [sales], ["contacts", "inventory"])).statusCode).toBe(
      409,
    );
    expect((await edit(0, [warehouse], [])).statusCode).toBe(200);
    expect(await rows(people[0].id)).toEqual([]);
    expect((await rows(people[1].id)).map((r) => r.module_id)).toEqual(
      ["contacts", id, "inventory"].sort(),
    );
    // An older member cannot displace a currently assigned newer member.
    expect((await edit(0, [sales], [])).statusCode).toBe(409);
    expect(
      (await members())
        .find((m) => m.id === people[0].id)!
        .roles.map((r) => r.id),
    ).toEqual([warehouse]);
    await inWorkspace(db, workspace, (tx) =>
      applySubscription(
        tx,
        workspace,
        {
          id: "sub_release",
          status: "active",
          items: { data: [{ price: { id: "price_inventory" }, quantity: 3 }] },
        },
        { inventory: "price_inventory" },
        productServerRuntime.catalog,
      ),
    );
    expect((await edit(0, [sales], [])).statusCode).toBe(200);
    expect((await rows(people[1].id)).map((r) => r.module_id)).toEqual(
      ["contacts", id, "inventory"].sort(),
    );
    const pin = async (version: string, expected: number) =>
      server.app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${workspace}/platform`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: {
          action: "pin",
          value: { moduleId: id, version, mandatory: true },
          version: expected,
        },
      });
    const pinned = await pin("1.0.0", 0);
    expect(pinned.statusCode, pinned.body).toBe(200);
    expect((await rows(people[0].id)).map((r) => r.module_id)).toEqual(
      ["contacts", id].sort(),
    );
    await publish("1.3.0", {});
    expect((await bootstrap()).statusCode).toBe(200);
    expect((await rows(people[0].id)).map((r) => r.module_id)).toEqual(
      ["contacts", id].sort(),
    );
    const unpinned = await pin("", 1);
    expect(unpinned.statusCode, unpinned.body).toBe(200);
    expect(await rows(people[0].id)).toEqual([
      { module_id: id, direct: false },
    ]);
    expect(
      (await rows(people[1].id)).find((r) => r.module_id === "contacts")
        ?.direct,
    ).toBe(true);
    expect(await audit()).toBe(2);
    expect((await edit(0, [warehouse], [])).statusCode).toBe(200);
    const retainedPin = await pin("1.3.0", 2);
    expect(retainedPin.statusCode, retainedPin.body).toBe(200);
    const beforeUnavailable = (await state()).organization!;
    const appliedRevision = async () =>
      (
        await admin.query(
          "select registry_revision from suite.module_policy_refresh where workspace_id=$1",
          [workspace],
        )
      ).rows[0].registry_revision as string;
    const cursorBefore = await appliedRevision();
    await publish("1.4.0", {});
    await admin.query(
      "update suite.memberships set active=false where workspace_id=$1 and id=$2",
      [workspace, people[0].id],
    );
    expect((await bootstrap()).statusCode).toBe(403);
    expect(await appliedRevision()).toBe(cursorBefore);
    await admin.query(
      "update suite.memberships set active=true where workspace_id=$1 and id=$2",
      [workspace, people[0].id],
    );
    // Lose the pinned release while other published versions remain. Removing
    // every version would exercise the intentional development catalog fallback.
    await admin.query(
      "delete from suite.module_releases where module_id=$1 and version='1.3.0'",
      [id],
    );
    const { version: unavailableVersion, ...unavailablePolicy } =
      beforeUnavailable;
    unavailablePolicy.tags![0].name = "Unavailable release team";
    const unrelated = await server.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspace}/platform`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: {
        action: "organization",
        value: unavailablePolicy,
        version: unavailableVersion,
      },
    });
    expect(unrelated.statusCode, unrelated.body).toBe(200);
    expect((await edit(0, [sales], [])).statusCode).toBe(409);
    expect(
      (
        await admin.query(
          "select role_id from suite.role_assignments where workspace_id=$1 and membership_id=$2",
          [workspace, people[0].id],
        )
      ).rows.map((row) => row.role_id),
    ).toEqual([warehouse]);
    // The new checkpoint table retains tenant isolation.
    await expect(
      inWorkspace(db, randomUUID(), (tx) =>
        tx
          .insertInto("suite.module_policy_refresh")
          .values({ workspace_id: workspace, registry_revision: "0" })
          .execute(),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      inWorkspace(db, workspace, (tx) =>
        tx
          .updateTable("suite.registry_revision")
          .set({ revision: "0" })
          .where("id", "=", true)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      Number(
        (await worker.query("select revision from suite.registry_revision"))
          .rows[0].revision,
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(
      await worker.query(
        "select has_table_privilege(current_user,'suite.module_policy_refresh','select') can_read, has_table_privilege(current_user,'suite.module_policy_refresh','update') can_write",
      ),
    ).toMatchObject({ rows: [{ can_read: true, can_write: false }] });
    await expect(
      worker.query("update suite.registry_revision set revision=0"),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      worker.query(
        "update suite.module_policy_refresh set registry_revision=0",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await server.app.close();
    await db.destroy();
    await registry.end();
    await worker.end();
    await admin.end();
  }
});
