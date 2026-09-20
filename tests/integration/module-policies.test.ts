import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app";
import { applySubscription } from "../../apps/api/src/billing";
import {
  connectDatabase,
  identify,
  inWorkspace,
  provisionWorkspace,
} from "../../composition/src/server/product";
import { productServerRuntime } from "../../composition/src/presets/index";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { OrganizationPolicy } from "@suite/module-sdk/governance";
const db = connectDatabase();
const admin = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL,
});
let server: Awaited<ReturnType<typeof createApp>>;
beforeAll(async () => {
  server = await createApp({
    db,
    auth: {
      mode: "development",
      origin: "http://localhost:4300",
      apiOrigin: "http://localhost:4310",
      mfaClaim: "mfa",
    },
  });
});
afterAll(async () => {
  await server.app.close();
  await admin.end();
  await db.destroy();
});
async function fixture() {
  const owner = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    email: `${randomUUID()}@test.local`,
    name: "Owner",
    emailVerified: true,
  });
  const workspace = randomUUID();
  await inWorkspace(db, workspace, (tx) =>
    provisionWorkspace(tx, {
      id: workspace,
      userId: owner.id,
      kind: "company",
      name: "Module policies",
    }),
  );
  const session = await server.auth.issue(owner.id, true);
  const headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
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
  const initial = await state();
  const sales = initial.roles.find((r) => r.name === "Sales")!.id;
  const warehouse = initial.roles.find((r) => r.name === "Warehouse")!.id;
  const add = async (role = sales) => {
    const user = await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Policy member",
      emailVerified: true,
    });
    const member = randomUUID();
    await admin.query(
      "insert into suite.memberships(id,workspace_id,user_id) values($1,$2,$3)",
      [member, workspace, user.id],
    );
    await admin.query(
      "insert into suite.role_assignments(workspace_id,membership_id,role_id) values($1,$2,$3)",
      [workspace, member, role],
    );
    return member;
  };
  const save = async (
    policy: OrganizationPolicy,
    version?: number,
    key = randomUUID(),
  ) =>
    server.app.inject({
      method: "POST",
      url: `/api/v1/workspaces/${workspace}/platform`,
      headers: { ...headers, "idempotency-key": key },
      payload: {
        action: "organization",
        value: policy,
        version: version ?? (await state()).organization!.version,
      },
    });
  const policy = () => {
    const { version: _version, ...value } = initial.organization!;
    return structuredClone(value);
  };
  const rows = async (member: string) =>
    (
      await admin.query<{ module_id: string; direct: boolean }>(
        "select module_id,direct from suite.module_assignments where workspace_id=$1 and membership_id=$2 order by module_id",
        [workspace, member],
      )
    ).rows;
  const edit = async (
    member: string,
    roleIds: string[],
    modules: string[] = [],
    directModules?: string[],
    active = true,
  ) =>
    server.app.inject({
      method: "PATCH",
      url: `/api/v1/workspaces/${workspace}/members/${member}`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: {
        revision: (
          await server.app.inject({
            method: "GET",
            url: `/api/v1/workspaces/${workspace}/members`,
            headers,
          })
        )
          .json<{ id: string; revision: string }[]>()
          .find((item) => item.id === member)!.revision,
        active,
        roleIds,
        modules,
        ...(directModules ? { directModules } : {}),
      },
    });
  return {
    workspace,
    headers,
    state,
    sales,
    warehouse,
    add,
    save,
    policy,
    rows,
    edit,
  };
}
it("keeps direct and overlapping group/tag sources distinct across membership and legacy-client edits", async () => {
  const f = await fixture(),
    member = await f.add();
  const policy = f.policy();
  policy.tags = [
    {
      id: randomUUID(),
      name: "Projects team",
      rankIds: [f.sales],
      grants: [],
      denies: [],
      modules: ["projects"],
    },
  ];
  const saved = await f.save(policy);
  expect(saved.statusCode, saved.body).toBe(200);
  expect(await f.rows(member)).toEqual([
    { module_id: "contacts", direct: false },
    { module_id: "projects", direct: false },
  ]);
  const legacy = await f.edit(member, [f.sales], ["contacts", "projects"]);
  expect(legacy.statusCode, legacy.body).toBe(200);
  expect((await f.rows(member)).every((r) => !r.direct)).toBe(true);
  const explicit = await f.edit(
    member,
    [f.sales],
    ["contacts", "projects"],
    ["contacts"],
  );
  expect(explicit.statusCode, explicit.body).toBe(200);
  policy.groups.push({
    id: randomUUID(),
    name: "Contacts team",
    rankIds: [f.sales],
    grants: [],
    denies: [],
    tags: [],
    modules: ["contacts"],
  });
  expect((await f.save(policy)).statusCode).toBe(200);
  // Older organization clients preserve module policy by group/tag identity.
  const older = structuredClone(policy);
  delete older.tags![0].modules;
  delete older.groups[0].modules;
  expect((await f.save(older)).statusCode).toBe(200);
  expect((await f.state()).organization!.tags![0].modules).toEqual([
    "projects",
  ]);
  policy.tags = [];
  expect((await f.save(policy)).statusCode).toBe(200);
  expect(await f.rows(member)).toEqual([
    { module_id: "contacts", direct: true },
  ]);
  // Removing the last policy source never removes direct access.
  policy.groups = [];
  expect((await f.save(policy)).statusCode).toBe(200);
  expect(await f.rows(member)).toEqual([
    { module_id: "contacts", direct: true },
  ]);
  expect((await f.edit(member, [f.sales], [], [])).statusCode).toBe(200);
  policy.tags = [
    {
      id: randomUUID(),
      name: "Projects",
      rankIds: [f.sales],
      grants: [],
      denies: [],
      modules: ["projects"],
    },
  ];
  expect((await f.save(policy)).statusCode).toBe(200);
  expect(
    (await f.edit(member, [f.warehouse], ["contacts", "projects"])).statusCode,
  ).toBe(200);
  expect(await f.rows(member)).toEqual([]);
  expect((await f.edit(member, [f.sales])).statusCode).toBe(200);
  expect((await f.rows(member)).map((r) => r.module_id)).toEqual([
    "contacts",
    "projects",
  ]);
  expect(
    (await f.edit(member, [f.sales], [], undefined, false)).statusCode,
  ).toBe(200);
  expect(await f.rows(member)).toEqual([]);
});
it("rejects bulk oversubscription atomically and deduplicates concurrent accepted changes", async () => {
  const f = await fixture(),
    first = await f.add(),
    second = await f.add();
  const policy = f.policy();
  policy.tags = [
    {
      id: randomUUID(),
      name: "Contacts",
      rankIds: [f.sales],
      grants: [],
      denies: [],
      modules: ["contacts"],
    },
  ];
  await admin.query(
    "update suite.entitlements set seat_limit=2 where workspace_id=$1 and module_id='contacts'",
    [f.workspace],
  );
  const before = (await f.state()).organization!.version;
  const denied = await f.save(policy);
  expect(denied.statusCode, denied.body).toBe(409);
  expect((await f.state()).organization!.version).toBe(before);
  expect(await f.rows(first)).toEqual([]);
  expect(await f.rows(second)).toEqual([]);
  await admin.query(
    "update suite.entitlements set seat_limit=3 where workspace_id=$1 and module_id='contacts'",
    [f.workspace],
  );
  const key = randomUUID();
  const replies = await Promise.all([
    f.save(policy, before, key),
    f.save(policy, before, key),
  ]);
  expect(replies.map((r) => r.statusCode)).toEqual([200, 200]);
  expect((await f.state()).organization!.version).toBe(before + 1);
  expect((await f.rows(first)).length).toBe(1);
  expect((await f.rows(second)).length).toBe(1);
  const audit = await admin.query(
    "select count(*)::int as n from suite.audit where workspace_id=$1 and action='platform.organization'",
    [f.workspace],
  );
  expect(audit.rows[0].n).toBe(1);
  policy.tags![0].modules = ["unregistered"];
  expect((await f.save(policy)).statusCode).not.toBe(200);
  expect((await f.state()).organization!.version).toBe(before + 1);
});
it("reconciles policy access after billing shrink, restoration and payment failure without exceeding seats", async () => {
  const f = await fixture(),
    first = await f.add(),
    second = await f.add();
  const policy = f.policy();
  policy.tags = [
    {
      id: randomUUID(),
      name: "Contacts",
      rankIds: [f.sales],
      grants: [],
      denies: [],
      modules: ["contacts"],
    },
  ];
  expect((await f.save(policy)).statusCode).toBe(200);
  const billing = async (quantity: number, status = "active") =>
    inWorkspace(db, f.workspace, (tx) =>
      applySubscription(
        tx,
        f.workspace,
        {
          id: "sub_policy",
          status,
          items: { data: [{ price: { id: "price_contacts" }, quantity }] },
        },
        { contacts: "price_contacts" },
        productServerRuntime.catalog,
      ),
    );
  await billing(2);
  expect((await f.rows(first)).length + (await f.rows(second)).length).toBe(1);
  await billing(3);
  expect((await f.rows(first)).length + (await f.rows(second)).length).toBe(2);
  await billing(3, "past_due");
  expect(await f.rows(first)).toEqual([]);
  expect(await f.rows(second)).toEqual([]);
  await billing(3);
  expect((await f.rows(first)).length + (await f.rows(second)).length).toBe(2);
  expect((await f.state()).organization!.tags![0].modules).toEqual([
    "contacts",
  ]);
});
it("requires module administration for policy changes and reports saved sources to member administration", async () => {
  const f = await fixture(),
    member = await f.add();
  const policy = f.policy();
  policy.tags = [
    {
      id: randomUUID(),
      name: "Contacts team",
      rankIds: [f.sales],
      grants: [],
      denies: [],
      modules: ["contacts"],
    },
  ];
  await admin.query(
    "update suite.roles set permissions=array['roles.manage'] where workspace_id=$1 and id=$2",
    [f.workspace, f.sales],
  );
  const user = (
    await admin.query("select user_id from suite.memberships where id=$1", [
      member,
    ])
  ).rows[0].user_id as string;
  const session = await server.auth.issue(user, true);
  const denied = await server.app.inject({
    method: "POST",
    url: `/api/v1/workspaces/${f.workspace}/platform`,
    headers: {
      ...f.headers,
      cookie: `suite_session=${session.token}`,
      "x-csrf-token": session.csrfToken,
      "idempotency-key": randomUUID(),
    },
    payload: {
      action: "organization",
      value: policy,
      version: (await f.state()).organization!.version,
    },
  });
  expect(denied.statusCode, denied.body).toBe(403);
  expect(await f.rows(member)).toEqual([]);
  expect((await f.save(policy)).statusCode).toBe(200);
  const members = (
    await server.app.inject({
      method: "GET",
      url: `/api/v1/workspaces/${f.workspace}/members`,
      headers: f.headers,
    })
  ).json();
  expect(members.find((m: { id: string }) => m.id === member)).toMatchObject({
    modules: ["contacts"],
    directModules: [],
    modulePolicies: [
      { moduleId: "contacts", sources: ["Tag: Contacts team"], assigned: true },
    ],
  });
  const suspend = await server.app.inject({
    method: "PATCH",
    url: `/api/v1/workspaces/${f.workspace}/modules/contacts`,
    headers: { ...f.headers, "idempotency-key": randomUUID() },
    payload: { state: "suspended", accessPolicy: "admin" },
  });
  expect(suspend.statusCode, suspend.body).toBe(200);
  expect(await f.rows(member)).toEqual([]);
  // Suspension does not prevent removing membership or an obsolete policy.
  expect(
    (await f.edit(member, [f.sales], [], undefined, false)).statusCode,
  ).toBe(200);
  policy.tags = [];
  expect((await f.save(policy)).statusCode).toBe(200);
});
it("applies invitation policies atomically and leaves an invitation pending when seats run out", async () => {
  const f = await fixture();
  const policy = f.policy();
  policy.groups.push({
    id: randomUUID(),
    name: "Project staff",
    rankIds: [f.sales],
    tags: [],
    grants: [],
    denies: [],
    modules: ["projects"],
  });
  expect((await f.save(policy)).statusCode).toBe(200);
  const user = await identify(db, {
    issuer: "test",
    subject: randomUUID(),
    email: `${randomUUID()}@test.local`,
    name: "New staff",
    emailVerified: true,
  });
  const invitation = await server.app.inject({
    method: "POST",
    url: `/api/v1/workspaces/${f.workspace}/invitations`,
    headers: { ...f.headers, "idempotency-key": randomUUID() },
    payload: { email: user.email, roleId: f.sales },
  });
  expect(invitation.statusCode, invitation.body).toBe(200);
  const id = invitation.json().id;
  const session = await server.auth.issue(user.id, true);
  const accept = () =>
    server.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${id}/accept`,
      headers: {
        ...f.headers,
        cookie: `suite_session=${session.token}`,
        "x-csrf-token": session.csrfToken,
        "idempotency-key": randomUUID(),
      },
      payload: {},
    });
  await admin.query(
    "update suite.entitlements set seat_limit=1 where workspace_id=$1 and module_id='projects'",
    [f.workspace],
  );
  const denied = await accept();
  expect(denied.statusCode, denied.body).toBe(409);
  expect(
    (await admin.query("select state from suite.invitations where id=$1", [id]))
      .rows[0].state,
  ).toBe("pending");
  expect(
    (
      await admin.query(
        "select id from suite.memberships where workspace_id=$1 and user_id=$2",
        [f.workspace, user.id],
      )
    ).rows,
  ).toEqual([]);
  await admin.query(
    "update suite.entitlements set seat_limit=2 where workspace_id=$1 and module_id='projects'",
    [f.workspace],
  );
  const accepted = await accept();
  expect(accepted.statusCode, accepted.body).toBe(200);
  const member = (
    await admin.query(
      "select id from suite.memberships where workspace_id=$1 and user_id=$2",
      [f.workspace, user.id],
    )
  ).rows[0].id;
  expect(await f.rows(member)).toEqual([
    { module_id: "contacts", direct: false },
    { module_id: "projects", direct: false },
  ]);
  expect((await accept()).statusCode).toBe(200);
  expect(await f.rows(member)).toHaveLength(2);
});
it("does not trust retained derived rows after their policy source disappears", async () => {
  const { checkModule } = await import("../../composition/src/server/product");
  const f = await fixture(),
    member = await f.add();
  await admin.query(
    "insert into suite.module_assignments(workspace_id,membership_id,module_id,direct) values($1,$2,'contacts',false)",
    [f.workspace, member],
  );
  await expect(
    inWorkspace(db, f.workspace, (tx) =>
      checkModule(tx, f.workspace, member, "contacts"),
    ),
  ).rejects.toMatchObject({ code: "MODULE_NOT_ASSIGNED" });
  const user = (
    await admin.query("select user_id from suite.memberships where id=$1", [
      member,
    ])
  ).rows[0].user_id;
  const session = await server.auth.issue(user, true);
  const boot = await server.app.inject({
    method: "GET",
    url: `/api/v1/workspaces/${f.workspace}/bootstrap`,
    headers: { cookie: `suite_session=${session.token}` },
  });
  expect(boot.statusCode, boot.body).toBe(200);
  expect(
    boot
      .json()
      .modules.find((m: { moduleId: string }) => m.moduleId === "contacts")
      .assigned,
  ).toBe(false);
  // A separately authorized direct grant remains valid.
  await admin.query(
    "update suite.module_assignments set direct=true where workspace_id=$1 and membership_id=$2",
    [f.workspace, member],
  );
  await expect(
    inWorkspace(db, f.workspace, (tx) =>
      checkModule(tx, f.workspace, member, "contacts"),
    ),
  ).resolves.toBeUndefined();
});
