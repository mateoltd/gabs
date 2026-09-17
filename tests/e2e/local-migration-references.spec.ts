import "dotenv/config";
import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { mkdir, readFile } from "node:fs/promises";
import { publishLocalPackage } from "../support/local-package-fixture";
import { selectValue } from "./controls.helpers";
import type { LocalData } from "../../packages/client/src/identity/local-profiles";

test("signed local updates reject broken new links and preserve historical archived links across recovery", async ({
  page,
}) => {
  test.setTimeout(150000);
  const id = `local-link-upgrade-${crypto.randomUUID().slice(0, 8)}`,
    name = `Local links ${id.slice(-8)}`;
  const publish = (version: string, invalid = false) =>
    publishLocalPackage({
      id,
      name,
      version,
      field: version === "1.0.0" ? "text" : "body",
      ...(version === "1.0.0"
        ? {}
        : {
            localStorage: {
              version: 2,
              compatible: { minimum: 2, maximum: 2 },
              migrations: { rename: { from: 1, to: 2 } },
            },
          }),
      transform: (filename, source) => {
        if (filename === "module.ts")
          return source.replace(
            "},{title:'Notes'",
            `,links:Type.Optional(Type.Array(field.reference('${id}','items')))},{title:'Notes'`,
          );
        return `import {defineLocalModule} from '@suite/module-sdk/local';import module from './module';export default defineLocalModule(module)({async capture(ctx,input){const target=await ctx.resource('items').create({${version === "1.0.0" ? "text" : "body"}:'Archived target'});const note=await ctx.resource('items').create({${version === "1.0.0" ? "text" : "body"}:input.text,links:[target.id]});await ctx.resource('items').archive(target.id,target.version);return note.id;}}${version === "1.0.0" ? "" : `,{rename:async(ctx)=>{const page=await ctx.resource('items').scan();for(const row of page.items)await ctx.resource('items').write(row.id,{body:row.data.text??row.data.body,...(row.data.links?{links:${invalid ? "['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']" : "row.data.links"}}:{})},row.version);}}`});`;
      },
    });
  await publish("1.0.0");
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const exportProfile = async (): Promise<LocalData> => {
    const download = page.waitForEvent("download");
    await button("Export data").click();
    const file = await (await download).path();
    return JSON.parse(await readFile(file!, "utf8"));
  };
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      const BaseWorker = Worker;
      window.Worker = class extends BaseWorker {
        override postMessage(
          message: unknown,
          transfer: Transferable[] | StructuredSerializeOptions = [],
        ) {
          const value = structuredClone(message) as {
            migrationSource?: { artifact?: { package: { digest: string } } };
          };
          if (
            (window as unknown as { tamperHistorical?: boolean })
              .tamperHistorical &&
            value.migrationSource?.artifact
          )
            value.migrationSource.artifact.package.digest = "0".repeat(64);
          super.postMessage(value, transfer as Transferable[]);
        }
      };
    });
    await page.goto("/");
    await button("Open workspace").click();
    await expect(button("Account menu")).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspace = me.workspaces.find(
      (w: { kind: string }) => w.kind === "personal",
    ).id;
    await pool.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
      [workspace, id],
    );
    await pool.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
      [workspace, id],
    );
    await pool.query(
      "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1",
      [workspace, id],
    );
    await button("Account menu").click();
    await page
      .getByRole("menuitem", { name: "Local profiles", exact: true })
      .click();
    await page
      .getByLabel("Profile name", { exact: true })
      .fill("Local migration links");
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Create profile").click();
    const install = async () => {
      await button("Browse personal modules").click();
      await button(`Install ${name}`).click();
      await button("Save local installation").click();
    };
    await button("Manage local modules").click();
    await install();
    await expect(
      page.getByText(`${name} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    await button("Close dialog").click();
    await button("Local actions").click();
    await selectValue(page, "Action", id + "/capture");
    await page.getByLabel("Text", { exact: true }).fill("Historical note");
    await button("Run locally").click();
    await expect(
      page.getByText("Completed and saved locally.", { exact: true }),
    ).toBeVisible();
    await button("Close dialog").click();
    const original = await exportProfile();
    expect(original.records[id + "/items"]).toHaveLength(2);
    expect(
      original.records[id + "/items"].filter((r) => r.archived),
    ).toHaveLength(1);
    await publish("2.0.0", true);
    await page.evaluate(() => {
      (window as unknown as { tamperHistorical: boolean }).tamperHistorical =
        true;
    });
    await button("Manage local modules").click();
    await install();
    await expect(page.getByRole("alert")).toContainText(
      "checksum verification failed",
    );
    await page.evaluate(() => {
      (window as unknown as { tamperHistorical: boolean }).tamperHistorical =
        false;
    });
    await button("Save local installation").click();
    await expect(page.getByRole("alert")).toContainText(
      "referenced record was not found",
    );
    await mkdir("docs/verification/local-migration-references", {
      recursive: true,
    });
    await page.screenshot({
      path: "docs/verification/local-migration-references/rejected.png",
    });
    await button("Back to modules").click();
    await button("Discard installation").click();
    await button("Close dialog").click();
    const rejected = await exportProfile();
    expect(rejected.records).toEqual(original.records);
    expect(rejected.modules?.[id].version).toBe("1.0.0");
    expect(rejected.receipts).toEqual(original.receipts);
    await publish("2.0.1");
    await button("Manage local modules").click();
    await install();
    await expect(
      page.getByText(`${name} is ready in this local profile.`, {
        exact: true,
      }),
    ).toBeVisible();
    await button("Close dialog").click();
    const accepted = await exportProfile();
    expect(accepted.modules?.[id].schemaVersion).toBe(2);
    expect(accepted.modules?.[id].version).toBe("2.0.1");
    expect(accepted.modules?.[id].migrations).toHaveLength(1);
    expect(accepted.receipts).toEqual(original.receipts);
    const note = accepted.records[id + "/items"].find((r) => !r.archived)!;
    expect(note.data.body).toBe("Historical note");
    expect(note.data.links).toEqual(
      original.records[id + "/items"].find((r) => !r.archived)!.data.links,
    );
    await button("Lock profile").click();
    await page.getByRole("combobox", { name: "Profile", exact: true }).click();
    await page
      .getByRole("option", { name: "Local migration links", exact: true })
      .click();
    await page
      .getByLabel("Passphrase", { exact: true })
      .fill("correct horse battery staple");
    await button("Unlock profile").click();
    await selectValue(page, "Module and resource", id + "/items");
    await expect(
      page.getByRole("cell", { name: "Historical note", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.screenshot({
      path: "docs/verification/local-migration-references/recovered.png",
    });
  } finally {
    await pool.end();
  }
});
