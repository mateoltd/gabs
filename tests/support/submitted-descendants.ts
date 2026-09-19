import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { CommandCorrectionOptions } from "./command-correction-journey";

/** Real transport failures after approved continuation; never manufacture journal delivery state. */
export async function submittedDescendantJourney({
  options,
  page,
  scope,
  headers,
  modules,
  before,
  targets,
}: {
  options: CommandCorrectionOptions;
  page: Page;
  scope: { userId: string; workspaceId: string };
  headers: Record<string, string>;
  modules: { id: string; name: string }[];
  before: JournalEntry[];
  targets?: [string, string];
}) {
  const accepted = options.mode.endsWith("accepted");
  const child = before[1];
  const command = child.call.action === "operation";
  const read = () => options.storage(page, scope);
  const pending = async () => {
    const entry = (await read()).journal.find((e) => e.id === child.id)!;
    expect(entry.call).toEqual(child.call);
    expect(entry.supersededBy).toBeUndefined();
    return entry;
  };
  await expect
    .poll(async () => (await read()).journal.map((e) => e.state))
    .toEqual(["rejected", "pending", "pending", "accepted"]);
  await expect.poll(async () => (await pending()).delivery).toBe("uncertain");
  expect((await pending()).attempts).toBeGreaterThan(0);
  const corrected = (await read()).journal[3];
  expect((await pending()).dependencies).toEqual([corrected.id]);
  expect((await pending()).captureDependencies).toEqual([before[0].id]);

  // One uncertain dependent must not stall an unrelated queued command.
  await page.getByRole("link", { name: modules[0].name, exact: true }).click();
  await page
    .getByLabel("Note name", { exact: true })
    .fill("Independent progress");
  await page
    .getByRole("button", { name: "Save pending note", exact: true })
    .click();
  await expect
    .poll(async () => (await read()).journal[4]?.state)
    .toBe("accepted");
  expect((await read()).journal[2]).toEqual(before[2]);

  const settings = async () => {
    await page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  };
  const inspect = async () => {
    await settings();
    await page
      .getByRole("region", {
        name: `${modules[1].name} saved work`,
        exact: true,
      })
      .getByRole("button", {
        name: command ? /^Saved commands/ : /^Saved records and drafts/,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: command ? "Saved commands" : "Records and drafts",
      exact: true,
    });
    const item = dialog.getByRole("listitem").filter({ hasText: child.id });
    await expect(item).toHaveCount(1);
    return {
      dialog,
      item,
      resolve: item.getByRole("button", {
        name: command ? "Resolve outcome" : "Resolve record outcome",
        exact: true,
      }),
    };
  };
  await settings();
  await options.offline(true);
  page = await options.restartOffline();
  let inspection = await inspect();
  await expect(inspection.item).toContainText("Outcome unknown");
  await expect(inspection.resolve).toBeDisabled();
  await expect(
    inspection.item.getByRole("button", {
      name: /Review command|Resume command review/,
    }),
  ).toHaveCount(0);
  const details = inspection.item.locator("details > summary");
  for (const summary of await details.all()) await summary.click();
  if (child.call.action !== "archive")
    await expect(inspection.item).toContainText("Selected foreign command");
  else await expect(inspection.item).toContainText(targets![0]);
  const evidence = `docs/verification/submitted-descendants/${command ? "command" : child.call.action}-${accepted ? "accepted" : "cancelled"}`;
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${options.kind}-uncertain.png` });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await options.reconnect();
  inspection = await inspect();
  await options.loseSettlementReply();
  await inspection.resolve.click();
  const outcomeDialog = () =>
    page.getByRole("dialog", {
      name: command ? "Resolve command outcome" : "Resolve record outcome",
      exact: true,
    });
  const recover = () =>
    outcomeDialog().getByRole("button", {
      name: command
        ? "Recover result or stop retries"
        : "Recover record result or stop retries",
      exact: true,
    });
  await recover().click();
  await expect
    .poll(
      async () =>
        (
          await options.pool.query(
            "select outcome from suite.idempotency where workspace_id=$1 and key=$2",
            [scope.workspaceId, child.id],
          )
        ).rows[0]?.outcome,
    )
    .toBe(accepted ? "accepted" : "cancelled");
  // Wait for the failed settlement to release the synchronization lock before shutdown.
  await page.evaluate(
    (scope) =>
      navigator.locks.request(
        `suite-sync:${scope.userId}:${scope.workspaceId}`,
        async () => {},
      ),
    scope,
  );
  expect((await pending()).state).toBe("pending");
  await options.offline(true);
  page = await options.restartOffline();
  inspection = await inspect();
  await expect(inspection.item).toContainText("Outcome unknown");
  expect((await pending()).state).toBe("pending");
  await page.keyboard.press("Escape");
  await options.reconnect();
  inspection = await inspect();
  await inspection.resolve.click();
  await recover().click();
  await expect
    .poll(async () => (await pending()).state)
    .toBe(accepted ? "accepted" : "rejected");
  await expect(outcomeDialog()).toHaveCount(0);
  await expect(inspection.item).toContainText(
    accepted
      ? "Accepted"
      : command
        ? "The server stopped retries"
        : "Original request stopped",
  );
  const settled = await pending();
  expect(settled.dependencies).toEqual([corrected.id]);
  expect(settled.captureDependencies).toEqual([before[0].id]);
  expect((await read()).journal[2]).toEqual(before[2]);
  expect((await read()).journal).toHaveLength(5);
  if (!accepted) expect(settled.settlement).toBe("cancelled");
  await options.narrow();
  expect(
    await inspection.dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: `${evidence}/${options.kind}-resolved-narrow.png`,
  });

  const repeat = await options.api.post(
    `/api/v1/module/${child.call.moduleId}/workspaces/${scope.workspaceId}/${command ? "operations/capture" : "records"}`,
    {
      headers: {
        ...headers,
        "idempotency-key": child.id,
        "x-module-version": child.call.moduleVersion!,
      },
      data: command
        ? child.call.input
        : {
            action: child.call.action,
            resource: child.call.resource,
            input: child.call.input,
          },
    },
  );
  if (accepted) expect(repeat.ok(), await repeat.text()).toBe(true);
  else {
    expect(repeat.status()).toBe(409);
    expect(await repeat.json()).toMatchObject({ code: "ATTEMPT_CANCELLED" });
  }
  const records = (
    await options.pool.query(
      "select module_id, id, version, archived, data from suite.module_records where workspace_id=$1",
      [scope.workspaceId],
    )
  ).rows;
  expect(
    records
      .filter((r) => r.module_id === modules[0].id)
      .map((r) => r.data.name)
      .sort(),
  ).toEqual(["Corrected parent", "Independent progress"]);
  const children = records.filter((r) => r.module_id === modules[1].id);
  if (targets) {
    expect(children).toHaveLength(2);
    expect(children.find((r) => r.id === targets[0])).toMatchObject({
      version: accepted ? 2 : 1,
      archived: accepted && child.call.action === "archive",
      data: {
        name:
          accepted && child.call.action === "update"
            ? "Selected foreign command"
            : "Selected existing record",
      },
    });
    expect(children.find((r) => r.id === targets[1])).toMatchObject({
      version: 1,
      archived: false,
      data: { name: "Unselected existing record" },
    });
  } else {
    expect(children.map((r) => r.data)).toEqual(
      accepted ? [{ name: "Selected foreign command" }] : [],
    );
  }
  expect(
    (
      await options.pool.query(
        "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
        [scope.workspaceId, `${modules[0].id}.notes.create`],
      )
    ).rows[0].n,
  ).toBe(2);
  const action = `${modules[1].id}.notes.${command ? "create" : child.call.action}`;
  const effects = (
    await options.pool.query(
      "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
      [scope.workspaceId, action],
    )
  ).rows[0].n;
  expect(effects).toBe(accepted ? 1 : 0);
  const cancellationCount = (
    await options.pool.query(
      "select count(*)::int n from suite.audit where workspace_id=$1 and action='module.attempt.cancel' and target_id=$2",
      [scope.workspaceId, child.id],
    )
  ).rows[0].n;
  expect(cancellationCount).toBe(accepted ? 0 : 1);
}
