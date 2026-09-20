import { expect, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { assertSchema, type ResourceRecord } from "@suite/module-sdk";
import { SavedWorkRecoverySchema } from "@suite/module-sdk/platform";
import { selectValue } from "../../e2e/controls.helpers";
import { publishExecutableFixture } from "../executable-fixture";
import definition from "../../fixtures/queued-resources/module";
import { portabilityStorage } from "./devices";
import type { corporatePortability } from "./journey";

/** Actual SDK capture, UI reassignment/export and independent-device request recovery. */
export async function corporateRequestTargets(
  options: Parameters<typeof corporatePortability>[0] & {
    pool: Pool;
    action: "update" | "archive";
    choice: "original" | "reassigned";
    accepted?: boolean;
  },
) {
  let page = options.source;
  const id = `request-target-${randomUUID().slice(0, 8)}`;
  const name = `Request target notes ${id.slice(-8)}`;
  const transform = (file: string, source: string) =>
    file === "view.tsx"
      ? source.replace(
          ".queue.create({ name }, { dependencies:",
          ".queue.create({ name }, { id: recordId || undefined, dependencies:",
        )
      : source;
  const published = await publishExecutableFixture({
    id,
    name,
    sourceDirectory: "tests/fixtures/queued-resources",
    transform,
  });
  const me = await (await options.api.get("/api/v1/me")).json();
  const workspaceId = randomUUID();
  const scope = { userId: me.user.id as string, workspaceId };
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const response = await options.api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: workspaceId,
      name: "Imported request targets",
      currency: "EUR",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  await options.pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [workspaceId, id],
  );
  await options.pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [workspaceId, id],
  );
  await options.pool.query(
    "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
    [workspaceId, id],
  );
  await options.pool.query(
    "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      workspaceId,
      definition.permissions.map((permission) =>
        permission.replaceAll(definition.id, id),
      ),
    ],
  );
  const command = async (
    action: string,
    input: unknown,
    key: string = randomUUID(),
    version = published.version,
  ) => {
    const response = await options.api.post(
      `/api/v1/module/${id}/workspaces/${workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": key,
          "x-module-version": version,
        },
        data: { action, resource: "notes", input },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as ResourceRecord;
  };
  const original = await command("create", {
    id: randomUUID(),
    data: { name: "Original record" },
  });
  const navigate = (name: string) =>
    page
      .getByRole("navigation", {
        name: name === "Settings" ? "Preferences" : "Main navigation",
        exact: true,
      })
      .getByRole("link", { name, exact: true })
      .click();
  const enable = async () => {
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
    await navigate("Settings");
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Disable offline storage",
        exact: true,
      }),
    ).toBeVisible();
  };
  const close = async (dialog: Locator) => {
    await expect(
      dialog.getByRole("button", {
        name: "Refresh imported copies",
        exact: true,
      }),
    ).toBeEnabled();
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enable();
  await navigate(name);
  await page
    .getByLabel("Accepted record identity", { exact: true })
    .fill(original.id);
  await page
    .getByRole("button", { name: "Load accepted record", exact: true })
    .click();
  await expect(
    page.getByText("Loaded server version 1: Original record", { exact: true }),
  ).toBeVisible();
  await options.offline(true);
  await page.getByLabel("Note name", { exact: true }).fill("Separate record");
  await page
    .getByRole("button", { name: "Save pending note", exact: true })
    .click();
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
  await page.getByLabel("Note name", { exact: true }).fill("Recovered edit");
  await page
    .getByRole("button", {
      name: `Save pending ${options.action}`,
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await portabilityStorage(page, scope)).journal.length)
    .toBe(2);
  const captured = (await portabilityStorage(page, scope)).journal;
  expect(captured[1].dependencies).toEqual([captured[0].id]);
  await options.offline(false);
  await expect
    .poll(async () => (await portabilityStorage(page, scope)).journal[0].state)
    .toBe("conflict");
  // Replace the fixture's custom capture view with the public generated review UI.
  const current = await publishExecutableFixture({
    id,
    name,
    sourceDirectory: "tests/fixtures/queued-resources",
    transform: (file, source) =>
      file === "module.ts"
        ? source.replace('    view: "home",\n', "")
        : transform(file, source),
  });
  const rollout = await options.api.post(
    `/api/v1/workspaces/${workspaceId}/platform`,
    {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: {
        action: "rollout",
        version: 0,
        value: {
          moduleId: id,
          version: current.version,
          mandatory: false,
          acceptedVersions: [published.version],
        },
      },
    },
  );
  expect(rollout.ok(), await rollout.text()).toBe(true);
  await navigate("Modules");
  const card = page
    .locator(".module-install-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card).toContainText(`Version ${current.version}`);
  await card.getByRole("button", { name: "Update", exact: true }).click();
  await expect(card).toContainText(`Installed ${current.version}`);
  await navigate(name);
  await page
    .getByRole("group", {
      name: "Pending create: Separate record",
      exact: true,
    })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  await selectValue(
    page,
    `Record for later ${options.action === "archive" ? "archive" : "edit"} 1`,
    "separate",
  );
  await page
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await portabilityStorage(page, scope)).journal.find(
          (entry) =>
            entry.id !== captured[0].id && entry.call.action === "create",
        )?.state,
    )
    .toBe("accepted");
  const child = (await portabilityStorage(page, scope)).journal.find(
    (entry) => entry.call.action === options.action && !entry.supersededBy,
  )!;
  expect(child.recordRecovery?.targetId).not.toBe(original.id);
  expect(child.call.input).toEqual(captured[1].call.input);
  await options.offline(true);
  await navigate("Settings");
  await page.getByRole("button", { name: /^Saved records and drafts/ }).click();
  const source = page.getByRole("dialog", {
    name: "Records and drafts",
    exact: true,
  });
  const exported = async (requestId: string, filename: string) => {
    const path = resolve(options.directory, filename);
    await options.exportFile(
      source
        .getByRole("listitem")
        .filter({ has: page.getByText(requestId, { exact: true }) })
        .getByRole("button", { name: "Export saved request", exact: true }),
      path,
    );
    return { path, bytes: await readFile(path) };
  };
  const file = await exported(child.id, "child.json");
  const parent = await exported(child.dependencies[0], "parent.json");
  const input: unknown = JSON.parse(file.bytes.toString());
  assertSchema(SavedWorkRecoverySchema, input);
  if (input.selection !== "request")
    throw Error("Expected actual request export");
  expect(input.entry).toEqual(child);
  let accepted: ResourceRecord | undefined;
  if (options.accepted)
    accepted = await command(
      options.action,
      child.call.input,
      child.id,
      child.call.moduleVersion!,
    );
  const records = [
    await command("get", { id: original.id }),
    await command("get", { id: child.recordRecovery!.targetId }),
  ];
  for (let index = 0; index < records.length; index++) {
    if (options.accepted && index === 0) continue;
    records[index] = await command("update", {
      id: records[index].id,
      baseVersion: records[index].version,
      data: { name: index ? "Separate advanced" : "Original advanced" },
    });
  }
  page = await options.replaceDevice();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enable();
  const openImports = async (path: string) => {
    await navigate("Settings");
    await page
      .getByRole("button", { name: "Import saved work", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Imported saved work",
      exact: true,
    });
    await expect(
      dialog.getByLabel("Saved-work recovery file", { exact: true }),
    ).toBeEnabled();
    await dialog
      .getByLabel("Saved-work recovery file", { exact: true })
      .setInputFiles(path);
    await dialog
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    return dialog;
  };
  let imported = await openImports(file.path);
  const confirm = () =>
    imported.getByRole("button", { name: "Confirm restoration", exact: true });
  await expect(confirm()).toBeDisabled();
  await selectValue(page, "Record to review", options.choice);
  await imported
    .getByRole("button", { name: "Back to imported copies", exact: true })
    .click();
  await imported
    .getByRole("button", { name: "Restore for review", exact: true })
    .click();
  await expect(confirm()).toBeDisabled();
  const picker = imported.getByRole("combobox", {
    name: "Record to review",
    exact: true,
  });
  await picker.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("option", {
      name:
        options.choice === "original" ? "Original record" : "Reassigned record",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  if (!options.accepted) {
    const evidence = resolve("docs/verification/imported-request-targets");
    await mkdir(evidence, { recursive: true });
    const prefix = `${options.evidenceName}-${options.action}-${options.choice}`;
    await page.screenshot({
      path: resolve(evidence, `${prefix}.png`),
      animations: "disabled",
    });
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode(await page.evaluate(() => !!window.suiteDesktop))
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    await page.setViewportSize({ width: 390, height: 844 });
    await confirm().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve(evidence, `${prefix}-narrow.png`),
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize(viewport);
  } else {
    await selectValue(page, "Record to review", "reassigned");
    await confirm().click();
    await expect(imported.getByRole("alert")).toContainText("already accepted");
    await selectValue(page, "Record to review", "original");
  }
  await confirm().click();
  await expect(
    imported.getByText("Restored. The imported copy is retained separately.", {
      exact: true,
    }),
  ).toBeVisible();
  await close(imported);
  await page.reload();
  await navigate(name);
  const restored = (await portabilityStorage(page, scope)).journal.find(
    (entry) => entry.id === child.id,
  )!;
  expect(restored.call).toEqual(child.call);
  expect(restored.dependencies).toEqual(child.dependencies);
  if (options.accepted) {
    expect(restored.state).toBe("accepted");
    expect(restored.recordRecovery).toBeUndefined();
    expect(
      await command(
        options.action,
        child.call.input,
        child.id,
        child.call.moduleVersion!,
      ),
    ).toEqual(accepted);
    expect(await command("get", { id: original.id })).toEqual(records[0]);
    expect(await command("get", { id: records[1].id })).toEqual(records[1]);
    await expect(
      page.getByRole("button", { name: "Review", exact: true }),
    ).toHaveCount(0);
  } else {
    expect(restored.settlement).toBe("cancelled");
    await expect(
      page.getByRole("button", { name: "Review", exact: true }),
    ).toBeDisabled();
    imported = await openImports(parent.path);
    await confirm().click();
    await expect
      .poll(
        async () =>
          (await portabilityStorage(page, scope)).journal.find(
            (entry) => entry.id === child.dependencies[0],
          )?.state,
      )
      .toBe("accepted");
    await close(imported);
    await page.reload();
    await navigate(name);
    await page.getByRole("button", { name: "Review", exact: true }).click();
    const chosen = records[options.choice === "original" ? 0 : 1];
    const untouched = records[options.choice === "original" ? 1 : 0];
    if (options.action === "update") {
      const editor = page.getByRole("dialog", {
        name: "Edit record",
        exact: true,
      });
      await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
        String(chosen.data.name),
      );
      await expect(
        editor.getByRole("button", { name: "Save", exact: true }),
      ).toBeDisabled();
      await selectValue(page, "Use value for name", "local");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
    } else {
      const review = page.getByRole("dialog", {
        name: "Review archive",
        exact: true,
      });
      await expect(review).toContainText(String(chosen.data.name));
      await expect(review).toContainText(
        `Current server version: ${chosen.version}`,
      );
      const evidence = resolve("docs/verification/imported-request-targets");
      const prefix = `${options.evidenceName}-archive-${options.choice}-review`;
      await page.screenshot({
        path: resolve(evidence, `${prefix}.png`),
        animations: "disabled",
      });
      expect(
        (
          await new AxeBuilder({ page })
            .setLegacyMode(await page.evaluate(() => !!window.suiteDesktop))
            .include('[role="dialog"]')
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      await page.setViewportSize({ width: 390, height: 844 });
      await review
        .getByRole("button", { name: "Confirm reviewed archive", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(evidence, `${prefix}-narrow.png`),
        animations: "disabled",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.setViewportSize(viewport);
      await review
        .getByRole("button", { name: "Confirm reviewed archive", exact: true })
        .click();
    }
    await expect
      .poll(async () => (await command("get", { id: chosen.id })).version)
      .toBe(chosen.version + 1);
    const result = await command("get", { id: chosen.id });
    expect(result).toMatchObject({
      id: chosen.id,
      archived: options.action === "archive",
      data:
        options.action === "update" ? { name: "Recovered edit" } : chosen.data,
    });
    expect(await command("get", { id: untouched.id })).toEqual(untouched);
    const journal = (await portabilityStorage(page, scope)).journal;
    const stopped = journal.find((entry) => entry.id === child.id)!;
    expect(stopped.call).toEqual(child.call);
    expect(stopped.settlement).toBe("cancelled");
    expect(stopped.supersededBy).toBeTruthy();
    const replacement = journal.find(
      (entry) => entry.id === stopped.supersededBy,
    )!;
    expect(
      await command(
        options.action,
        replacement.call.input,
        replacement.id,
        replacement.call.moduleVersion!,
      ),
    ).toEqual(result);
    expect(await command("get", { id: chosen.id })).toEqual(result);
    const late = await options.api.post(
      `/api/v1/module/${id}/workspaces/${workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": child.id,
          "x-module-version": child.call.moduleVersion!,
        },
        data: {
          action: options.action,
          resource: "notes",
          input: child.call.input,
        },
      },
    );
    expect(late.status()).toBe(409);
    expect((await late.json()).code).toBe("ATTEMPT_CANCELLED");
  }
  expect(await readFile(file.path)).toEqual(file.bytes);
  expect(await readFile(parent.path)).toEqual(parent.bytes);
}
