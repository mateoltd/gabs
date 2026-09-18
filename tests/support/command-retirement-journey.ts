import { historicalPermissionJourney } from "./historical-permission-journey";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { CommandCorrectionOptions } from "./command-correction-journey";
import { selectValue } from "../e2e/controls.helpers";
import { publishExecutableFixture } from "./executable-fixture";

export async function commandRetirementJourney(
  options: CommandCorrectionOptions,
  saved: {
    id: string;
    fixtureName: string;
    scope: { userId: string; workspaceId: string };
    headers: Record<string, string>;
    pkg: SignedArtifact;
    before: JournalEntry[];
  },
) {
  let page = options.page;
  const { api, pool, mode } = options;
  const { id, fixtureName, scope, headers, pkg, before } = saved;
  const journal = async () =>
    (await options.storage(page, scope)).journal.filter(
      (e) => e.call.moduleId === id,
    );
  const originalReview = (await options.storage(page, scope)).commandReviews?.[
    before[0].id
  ];
  const settle = (entry: JournalEntry) =>
    api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/attempts/settle`,
      {
        headers: { ...headers, "x-module-version": pkg.version },
        data: {
          key: entry.id,
          call: {
            action: "operation",
            operation: "capture",
            input: entry.call.input,
          },
        },
      },
    );
  // The device still holds its earlier rejection. A competing original-version
  // request commits while this device is offline, before the new release lands.
  let accepted: unknown;
  if (mode === "service-only") {
    await pool.query(
      "update suite.module_activations set config=$3::jsonb where workspace_id=$1 and module_id=$2",
      [scope.workspaceId, id, JSON.stringify({ allowRejected: true })],
    );
    const reply = await api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/operations/capture`,
      {
        headers: {
          ...headers,
          "idempotency-key": before[0].id,
          "x-module-version": pkg.version,
        },
        data: before[0].call.input,
      },
    );
    expect(reply.ok(), await reply.text()).toBe(true);
    accepted = await reply.json();
  }
  const next = await publishExecutableFixture({
    id,
    name: fixtureName,
    sourceDirectory: "tests/fixtures/queued-notes",
    transform: (file, source) => {
      if (file === "module.ts")
        source = source.replace(
          "permissions: [",
          'permissions: [\n    "contacts.contacts.read",',
        );
      if (file === "view.tsx")
        return `import { defineView } from "@suite/module-sdk/ui";
import { PageHeading } from "@suite/ui-web";
import module from "./module";
export default defineView(module, function Notes() { return <PageHeading title="Retired capture workspace" description="Previously saved commands remain available through the host." />; });`;
      if (mode === "removed") {
        if (file === "module.ts")
          return source
            .replace(/    capture: operation\(\{[\s\S]*?\n    \}\),/, "")
            .replace(`    "${id}.capture",\n`, "");
        if (file === "module-server.ts")
          return source.replace(/  capture: async[\s\S]*?\n  \},/, "");
      } else if (file === "module.ts") {
        return source
          .replaceAll(`${id}.capture`, `${id}.capture-next`)
          .replace(
            'policy: "queued",',
            'policy: "online", serviceOnly: true, public: true,',
          );
      }
      return source;
    },
  });
  const rollout = await api.post(
    `/api/v1/workspaces/${scope.workspaceId}/platform`,
    {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: {
        action: "rollout",
        version: 0,
        value: {
          moduleId: id,
          version: next.version,
          mandatory: false,
          acceptedVersions: [pkg.version],
        },
      },
    },
  );
  expect(rollout.ok(), await rollout.text()).toBe(true);
  await options.reconnect();
  await page.reload();
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  const card = page.locator(".module-install-card").filter({
    has: page.getByRole("heading", { name: fixtureName, exact: true }),
  });
  await expect(card).toContainText(`Version ${next.version}`);
  const update = card.getByRole("button", { name: "Update", exact: true });
  if (await update.isVisible()) await update.click();
  await expect(card).toContainText(`Installed ${next.version}`);
  const open = async () => {
    await page.getByRole("link", { name: fixtureName, exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Retired capture workspace",
        exact: true,
      }),
    ).toBeVisible();
  };
  const inbox = async () => {
    await open();
    await page.getByRole("button", { name: /^Saved commands/ }).click();
    const dialog = page.getByRole("dialog", {
      name: "Saved commands",
      exact: true,
    });
    await expect(dialog).toHaveClass(/is-open/);
    return dialog;
  };
  // Only the current grant cannot disclose the original input or review.
  await pool.query(
    "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
    [scope.workspaceId, `${id}.capture`],
  );
  await page.reload();
  await open();
  await expect(
    page.getByRole("button", { name: /^Saved commands/ }),
  ).toHaveCount(0);
  const denied = await settle(before[0]);
  expect(denied.status(), await denied.text()).toBe(403);
  if (mode === "service-only") {
    // Only the historical grant is insufficient when a current contract exists.
    await pool.query(
      "update suite.roles set permissions=array_append(array_remove(permissions,$2),$3) where workspace_id=$1",
      [scope.workspaceId, `${id}.capture-next`, `${id}.capture`],
    );
    await page.reload();
    await open();
    await expect(
      page.getByRole("button", { name: /^Saved commands/ }),
    ).toHaveCount(0);
    expect((await settle(before[0])).status()).toBe(403);
  }
  await pool.query(
    "update suite.roles set permissions=array_append(array_remove(permissions,$2),$3) where workspace_id=$1",
    [scope.workspaceId, `${id}.capture`, `${id}.capture-next`],
  );
  await page.reload();
  await historicalPermissionJourney(
    { ...options, page },
    {
      id,
      scope,
      headers,
      version: pkg.version,
      denied: () => settle(before[0]),
    },
  );
  if (mode === "service-only") {
    // Recovery of an old public receipt does not expose today's service-only handler.
    const currentSettle = await api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/attempts/settle`,
      {
        headers: { ...headers, "x-module-version": next.version },
        data: {
          key: randomUUID(),
          call: {
            action: "operation",
            operation: "capture",
            input: { name: "Not a public command" },
          },
        },
      },
    );
    expect(currentSettle.status()).toBe(403);
    expect((await currentSettle.json()).code).toBe("INVALID_RECOVERY_TARGET");
    const currentExecute = await api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/operations/capture`,
      {
        headers: {
          ...headers,
          "x-module-version": next.version,
          "idempotency-key": randomUUID(),
        },
        data: { name: "Must not execute" },
      },
    );
    expect(currentExecute.status()).toBe(403);
  }
  await page.reload();
  let dialog = await inbox();
  const entries = () =>
    dialog.locator("li").filter({
      has: page.getByRole("heading", { name: "Save note", exact: true }),
    });
  await expect(entries()).toHaveCount(3);
  await expect(
    dialog.getByRole("button", { name: "Retry pending commands", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", {
      name: /Review command|Resume command review/,
    }),
  ).toHaveCount(0);
  const snapshot = await journal();
  await options.offline(true);
  page = await options.restartOffline();
  dialog = await inbox();
  await expect(entries()).toHaveCount(3);
  await entries()
    .first()
    .getByText("View saved input", { exact: true })
    .click();
  await entries()
    .first()
    .getByText("View saved review", { exact: true })
    .click();
  for (const summary of ["View saved input", "View saved review"]) {
    await entries()
      .first()
      .locator("details")
      .filter({ has: page.locator(":scope > summary", { hasText: summary }) })
      .getByText("1 field", { exact: true })
      .click();
  }
  await expect(
    entries().first().getByText("Reject this note", { exact: true }),
  ).toBeVisible();
  await expect(
    entries().first().getByText("Corrected parent", { exact: true }),
  ).toBeVisible();
  await expect(entries().first()).toContainText("Reject this note");
  await expect(entries().first()).toContainText("Corrected parent");
  await expect(
    entries()
      .first()
      .getByRole("button", { name: "Resolve outcome", exact: true }),
  ).toBeDisabled();
  await options.narrow();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `docs/verification/command-retirement/${options.kind}-${mode}-readonly-narrow.png`,
  });
  await options.wide();
  await page.keyboard.press("Escape");
  await options.reconnect();
  await page.reload();
  dialog = await inbox();
  await options.loseSettlementReply();
  await entries()
    .first()
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  const resolve = () =>
    page
      .getByRole("dialog", { name: "Resolve command outcome", exact: true })
      .getByRole("button", {
        name: "Recover result or stop retries",
        exact: true,
      });
  await resolve().click();
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            "select count(*)::int as count from suite.idempotency where workspace_id=$1 and key=$2",
            [scope.workspaceId, before[0].id],
          )
        ).rows[0].count,
    )
    .toBe(1);
  // An existing receipt predates this request; observe the lost reply before restarting.
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect.poll(async () => (await journal())[0].state).toBe("rejected");
  await options.offline(true);
  page = await options.restartOffline();
  await options.reconnect();
  await page.reload();
  dialog = await inbox();
  await entries()
    .first()
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  await resolve().click();
  await expect
    .poll(async () => (await journal())[0].state)
    .toBe(mode === "removed" ? "rejected" : "accepted");
  if (mode === "removed")
    await expect
      .poll(async () => (await journal())[0].settlement)
      .toBe("cancelled");
  else expect((await journal())[0].result).toEqual(accepted);
  // Explicitly fence one never-submitted dependent, without dispatch or remapping.
  await entries()
    .nth(1)
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  await resolve().click();
  await expect
    .poll(async () => (await journal())[1].settlement)
    .toBe("cancelled");
  const final = await journal();
  expect(final.map((e) => e.call)).toEqual(before.map((e) => e.call));
  expect(final.map((e) => e.attempts)).toEqual(snapshot.map((e) => e.attempts));
  expect(final.map((e) => e.dependencies)).toEqual(
    before.map((e) => e.dependencies),
  );
  expect(final[2].state).toBe("pending");
  expect(final[2].delivery).toBe("unsubmitted");
  expect(
    (await options.storage(page, scope)).commandReviews?.[before[0].id],
  ).toEqual(originalReview);
  const repeated = await settle(before[0]);
  expect(repeated.ok(), await repeated.text()).toBe(true);
  expect((await repeated.json()).outcome).toBe(
    mode === "removed" ? "cancelled" : "accepted",
  );
  // A generated resource screen can synchronize its own captured edits, but
  // must not bypass the owning custom view's command authority checks.
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  await options.offline(true);
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Independent retirement contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "customer");
  await page
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const contact = (await options.storage(page, scope)).journal.find(
    (e) => e.call.moduleId === "contacts",
  )!;
  expect(contact.state).toBe("pending");
  await options.reconnect();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await options.storage(page, scope)).journal.find(
          (e) => e.id === contact.id,
        )?.state,
    )
    .toBe("accepted");
  expect((await journal()).map((e) => e.attempts)).toEqual(
    snapshot.map((e) => e.attempts),
  );
  expect((await journal())[2].delivery).toBe("unsubmitted");
  dialog = await inbox();
  const counts = await pool.query(
    "select (select count(*)::int from suite.module_records where workspace_id=$1 and module_id=$2) as records, (select count(*)::int from suite.audit where workspace_id=$1 and action='module.attempt.cancel') as cancellations",
    [scope.workspaceId, id],
  );
  expect(counts.rows[0]).toEqual({
    records: mode === "removed" ? 0 : 1,
    cancellations: mode === "removed" ? 2 : 1,
  });
  await entries()
    .first()
    .getByText(
      mode === "removed" ? "View saved input" : "View accepted result",
      { exact: true },
    )
    .click();
  await options.narrow();
  await page.screenshot({
    path: `docs/verification/command-retirement/${options.kind}-${mode}-recovered-narrow.png`,
  });
}
