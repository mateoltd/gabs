import "dotenv/config";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import type { ModuleDefinition } from "@suite/module-sdk";
import { signPackage } from "../../packages/module-sdk/node/signing";
import { buildServerPackage } from "../../packages/module-sdk/node/build-server";
import {
  submitRelease,
  reviewRelease,
  stageRelease,
  publishRelease,
} from "../../tooling/registry-review";
import { selectValue } from "./controls.helpers";

test("administrator upgrades stored module records through the real migration control", async ({
  page,
}) => {
  const id = `schema-ui-${randomUUID().slice(0, 8)}`,
    workspace = randomUUID();
  const name = `Schema upgrade notes ${id.slice(-8)}`;
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const registry = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    options: "-c role=suite_registry",
  });
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/migration-ui-"));
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
    const privateKey = await readFile(`${keys}/private.pem`, "utf8"),
      publicKey = await readFile(`${keys}/public.pem`, "utf8");
    for (const version of [1, 2]) {
      const folder = resolve(directory, String(version));
      await mkdir(folder);
      await writeFile(
        resolve(folder, "module.ts"),
        `import {defineModule,resource,field,Type} from '@suite/module-sdk'; export default defineModule({id:'${id}',name:'${name}',version:'${version}.0.0',description:'Migration UI fixture',host:'^1.0.0',backend:'^1.0.0',publisher:'suite',dependencies:{},permissions:['${id}.notes.read','${id}.notes.write'],configuration:Type.Object({}),operations:{},navigation:{path:'/${id}',permission:'${id}.notes.read'},resources:{notes:resource({name:field.text()${version === 2 ? ",category:field.text()" : ""}},{title:'Notes'})},storage:{version:${version},compatible:{minimum:${version},maximum:${version}},migrations:${version === 2 ? "{'add-category':{from:1,to:2}}" : "{}"}}});`,
      );
      if (version === 2)
        await writeFile(
          resolve(folder, "module-server.ts"),
          `import {defineModuleServer} from '@suite/module-sdk/server';import module from './module';export default defineModuleServer(module)({}, {'add-category':async(ctx)=>{let cursor;do{const page=await ctx.scan('notes',cursor);for(const row of page.items){await ctx.write('notes',row.id,{name:row.data.name,category:'general'},row.version);if(row.data.name==='Fail fixture')throw Error('Migration fixture rejected');}cursor=page.next??undefined;}while(cursor);}});`,
        );
      const module = (
        await import(pathToFileURL(resolve(folder, "module.ts")).href)
      ).default as ModuleDefinition;
      const submission = await submitRelease(
        registry,
        signPackage(module, privateKey),
        version === 2
          ? await buildServerPackage(module, folder, privateKey)
          : null,
        publicKey,
      );
      await reviewRelease(
        registry,
        submission,
        "approved",
        "Reviewed browser migration fixture",
        publicKey,
      );
      if (version === 2) await stageRelease(registry, submission, publicKey);
      await publishRelease(registry, submission, publicKey);
    }
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const headers = {
      origin: "http://localhost:4300",
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    };
    const created = await page.request.post("/api/v1/workspaces", {
      headers,
      data: {
        id: workspace,
        name: "Migration administration",
        currency: "EUR",
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const member = (
      await admin.query(
        "select id from suite.memberships where workspace_id=$1 and user_id=$2",
        [workspace, me.user.id],
      )
    ).rows[0].id;
    // Seed identity, entitlement and a legacy record; the actual schema change uses the administrator UI.
    await admin.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true) on conflict(workspace_id,module_id) do update set active=true",
      [workspace, id],
    );
    await admin.query(
      "insert into suite.module_activations(workspace_id,module_id,state,access_policy,config) values($1,$2,'enabled','admin','{}') on conflict(workspace_id,module_id) do update set state='enabled'",
      [workspace, id],
    );
    await admin.query(
      "insert into suite.module_assignments(workspace_id,module_id,membership_id) values($1,$2,$3) on conflict do nothing",
      [workspace, id, member],
    );
    await admin.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and name='Owner'",
      [workspace, [`${id}.notes.read`, `${id}.notes.write`]],
    );
    const record = randomUUID();
    await admin.query(
      "insert into suite.module_records(workspace_id,module_id,resource,id,data,created_by) values($1,$2,'notes',$3,$4,$5)",
      [workspace, id, record, { name: "Existing note" }, me.user.id],
    );
    await page.reload();
    await selectValue(page, "Workspace", workspace);
    await page.goto("/modules");
    const card = page.locator(".module-install-card").filter({
      has: page.getByRole("heading", {
        name,
        exact: true,
      }),
    });
    await card.getByRole("button", { name: "Configure", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: `Configure ${name}`,
      exact: true,
    });
    await expect(
      dialog.getByText("Current schema: 1.", { exact: false }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("combobox", {
        name: "Migration target release",
        exact: true,
      }),
    ).toContainText("2.0.0 (schema 2)");
    await mkdir("docs/verification/module-migrations", { recursive: true });
    await page.screenshot({
      path: "docs/verification/module-migrations/before.png",
    });
    await admin.query(
      "update suite.module_records set data=$4 where workspace_id=$1 and module_id=$2 and id=$3",
      [workspace, id, record, { name: "Fail fixture" }],
    );
    await dialog
      .getByRole("button", { name: "Migrate storage", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(
      dialog.getByText("Current schema: 1.", { exact: false }),
    ).toBeVisible();
    expect(
      (
        await admin.query(
          "select data,version from suite.module_records where workspace_id=$1 and module_id=$2 and id=$3",
          [workspace, id, record],
        )
      ).rows[0],
    ).toEqual({ data: { name: "Fail fixture" }, version: 1 });
    await page.screenshot({
      path: "docs/verification/module-migrations/failure.png",
    });
    await admin.query(
      "update suite.module_records set data=$4 where workspace_id=$1 and module_id=$2 and id=$3",
      [workspace, id, record, { name: "Existing note" }],
    );
    await dialog
      .getByRole("button", { name: "Migrate storage", exact: true })
      .click();
    await expect(
      dialog.getByText("Current schema: 2.", { exact: false }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Migrate storage", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: "docs/verification/module-migrations/after.png",
    });
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog
      .getByRole("button", { name: "Migrate storage", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/module-migrations/narrow.png",
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.keyboard.press("Escape");
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name, exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "Existing note", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "general", exact: true }),
    ).toBeVisible();
    expect(
      (
        await admin.query(
          "select count(*) from suite.module_migrations where workspace_id=$1 and module_id=$2",
          [workspace, id],
        )
      ).rows[0].count,
    ).toBe("1");
  } finally {
    await registry.end();
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
});
