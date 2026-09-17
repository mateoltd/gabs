import { expect, type Page } from "@playwright/test";
import type { Pool } from "pg";
import { publishExecutableFixture } from "./executable-fixture";
export const mapTupleId = `map-tuple-${crypto.randomUUID().slice(0, 8)}`;
export const mapTupleName = `Map and tuple ${mapTupleId.slice(-8)}`;
export const mapTupleRows = Array.from({ length: 105 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, "0")}`,
  data: { name: `Target ${String(i + 1).padStart(3, "0")}` },
}));
export const publishMapTuple = () =>
  publishExecutableFixture({
    id: mapTupleId,
    sourceDirectory: "tests/fixtures/map-tuple",
    transform: (_file, source) =>
      source
        .replaceAll("map-tuple", mapTupleId)
        .replaceAll("Map and tuple editor", mapTupleName),
  });
export async function assignMapTuple(pool: Pool, workspace: string) {
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspace, mapTupleId],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspace, mapTupleId],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
    [workspace, mapTupleId],
  );
  await pool.query(
    "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      workspace,
      ["records", "targets"].flatMap((resource) =>
        ["read", "write"].map(
          (action) => `${mapTupleId}.${resource}.${action}`,
        ),
      ),
    ],
  );
}
export const mapTupleExpected = () => ({
  name: "Structured record revised",
  pair: [mapTupleRows[104].id, 2],
  links: Object.fromEntries([["renamed", mapTupleRows[104].id]]),
  extras: { fixed: "kept", "a/b~c": mapTupleRows[104].id },
});
export async function exerciseMapTuple(page: Page) {
  const view = page.getByRole("region", {
    name: "Structured links",
    exact: true,
  });
  const button = (name: string) =>
    view.getByRole("button", { name, exact: true });
  const choose = async (label: string) => {
    const combo = view.getByRole("combobox", { name: label, exact: true });
    const picker = view.locator(".reference-picker").filter({
      has: page.getByRole("combobox", { name: label, exact: true }),
    });
    await picker.locator("summary").click();
    await picker.getByRole("textbox").fill("Target 105");
    await expect(picker.getByRole("status")).toHaveText("1 choice on page 1.");
    await combo.click();
    await page.getByRole("option", { name: "Target 105", exact: true }).click();
    await picker.locator("summary").click();
  };
  await expect(
    view.getByRole("heading", { name: "Structured links", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await view.getByLabel("Name", { exact: true }).fill("Structured record");
  await choose("Pair 1");
  await view.getByLabel("Quantity", { exact: true }).fill("2");
  await view.getByLabel("New key for links", { exact: true }).fill("primary");
  await expect(button("Save structured record")).toBeDisabled();
  await expect(button("Edit links as JSON")).toBeDisabled();
  await view.getByLabel("New key for links", { exact: true }).press("Enter");
  await choose("Links: primary");
  await view.getByLabel("New key for links", { exact: true }).fill("secondary");
  await button("Add links entry").click();
  await choose("Links: secondary");
  const key = view.getByLabel("Links key 1", { exact: true });
  await key.fill("secondary");
  await button("Rename links entry 1").click();
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await expect(button("Save structured record")).toBeDisabled();
  await key.press("Escape");
  await expect(key).toHaveValue("primary");
  await key.fill("__proto__");
  await key.press("Enter");
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await expect(button("Save structured record")).toBeDisabled();
  await key.press("Escape");
  await key.fill("renamed");
  await key.press("Enter");
  await expect(
    view.getByRole("combobox", { name: "Links: renamed", exact: true }),
  ).toContainText("Target 105");
  await view.getByLabel("New key for links", { exact: true }).fill("third");
  await button("Add links entry").click();
  await expect(button("Add links entry")).toBeDisabled();
  await button("Remove links entry 3").click();
  await button("Remove links entry 2").click();
  await expect(button("Remove links entry 1")).toBeDisabled();
  await view.getByLabel("New key for links", { exact: true }).fill("bad-key");
  await button("Add links entry").click();
  await expect(
    view.getByLabel("New key for links", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await view.getByLabel("New key for links", { exact: true }).press("Escape");
  await view.getByLabel("New key for extras", { exact: true }).fill("a/b~c");
  await button("Add extras entry").click();
  await choose("Extras: a/b~c");
  await button("Edit pair as JSON").click();
  await view
    .getByLabel("Pair", { exact: true })
    .fill(JSON.stringify([mapTupleRows[104].id, 2, "extra"]));
  await expect(button("Use structured pair editor")).toBeDisabled();
  await button("Discard JSON edits").click();
  await expect(view.getByLabel("Quantity", { exact: true })).toHaveValue("2");
  await button("Edit links as JSON").click();
  const json = view.getByLabel("Links", { exact: true });
  await json.fill('{"incomplete":');
  await expect(button("Use structured links editor")).toBeDisabled();
  await expect(button("Save structured record")).toBeDisabled();
  await view
    .getByLabel("Name", { exact: true })
    .fill("Structured record revised");
  await expect(json).toHaveValue('{"incomplete":');
  await button("Discard JSON edits").click();
  await expect(
    view.getByRole("combobox", { name: "Links: renamed", exact: true }),
  ).toContainText("Target 105");
  await button("Save structured record").click();
  await expect(
    view.getByRole("status").filter({ hasText: "Saved structured record" }),
  ).toBeVisible();
  return view;
}
