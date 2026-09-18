import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { createApp } from "../../apps/api/src/app";
import { provisionLegacyWorkspace as provisionWorkspace } from "../fixtures/legacy-workspace";
import {
  connectDatabase,
  identify,
  inWorkspace,
  authorize,
  idempotent,
  settleIdempotent,
  workspaceModule,
} from "../../composition/src/server/product";
import { settleModuleAttempt } from "../../packages/server/src/runtime/attempts";
import { executeResource } from "../../packages/server/src/runtime/resources";
import type { AttemptSettlementRequest } from "../../packages/contracts/src";
const db = connectDatabase();
let server: Awaited<ReturnType<typeof createApp>>;
let actor: Awaited<ReturnType<typeof identify>> & {
  mfa: boolean;
  emailVerified: boolean;
};
let headers: Record<string, string>;
let workspace: string;
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
  actor = {
    ...(await identify(db, {
      issuer: "test",
      subject: randomUUID(),
      email: `${randomUUID()}@test.local`,
      name: "Settlement owner",
      emailVerified: true,
    })),
    mfa: true,
    emailVerified: true,
  };
  workspace = randomUUID();
  await inWorkspace(db, workspace, (tx) =>
    provisionWorkspace(tx, {
      id: workspace,
      userId: actor.id,
      name: "Settlement",
      kind: "company",
    }),
  );
  const session = await server.auth.issue(actor.id, true);
  headers = {
    cookie: `suite_session=${session.token}`,
    origin: "http://localhost:4300",
    "x-csrf-token": session.csrfToken,
  };
});
afterAll(async () => {
  await server?.app.close();
  await db.destroy();
});
const call = () => ({
  action: "create" as const,
  resource: "contacts",
  input: {
    id: randomUUID(),
    data: { name: "Recovered", kind: "person", relationship: "customer" },
  },
});
const send = (
  key: string,
  body: ReturnType<typeof call>,
  auth = headers,
  workspaceId = workspace,
) =>
  server.app.inject({
    method: "POST",
    url: `/api/v1/module/contacts/workspaces/${workspaceId}/records`,
    headers: { ...auth, "idempotency-key": key, "x-module-version": "1.1.0" },
    payload: body,
  });
const settle = (
  key: string,
  body: AttemptSettlementRequest["call"],
  moduleId = "contacts",
  version = "1.1.0",
  workspaceId = workspace,
  auth = headers,
) =>
  server.app.inject({
    method: "POST",
    url: `/api/v1/module/${moduleId}/workspaces/${workspaceId}/attempts/settle`,
    headers: { ...auth, "x-module-version": version },
    payload: { key, call: body },
  });

it("permanently fences an exact missing attempt, rejects changed content, excludes cancelled receipts, and audits once", async () => {
  const key = randomUUID(),
    body = call();
  const replies = await Promise.all([settle(key, body), settle(key, body)]);
  for (const reply of replies) {
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json()).toEqual({ key, outcome: "cancelled" });
  }
  const late = await send(key, body);
  expect(late.statusCode).toBe(409);
  expect(late.json().code).toBe("ATTEMPT_CANCELLED");
  expect(
    (
      await settle(key, {
        ...body,
        input: {
          ...body.input,
          data: { ...body.input.data, name: "Different" },
        },
      })
    ).json().code,
  ).toBe("IDEMPOTENCY_CONFLICT");
  const lookup = await server.app.inject({
    method: "POST",
    url: `/api/v1/workspaces/${workspace}/module-receipts`,
    headers,
    payload: { keys: [key] },
  });
  expect(lookup.json()).toEqual({ accepted: [] });
  const state = await inWorkspace(db, workspace, async (tx) => ({
    records: await tx
      .selectFrom("suite.module_records")
      .selectAll()
      .where("id", "=", body.input.id)
      .execute(),
    audits: await tx
      .selectFrom("suite.audit")
      .selectAll()
      .where("target_id", "=", key)
      .execute(),
  }));
  expect(state.records).toHaveLength(0);
  expect(state.audits.map((a) => a.action)).toEqual(["module.attempt.cancel"]);
  const corrected = await send(randomUUID(), {
    ...body,
    input: { ...body.input, data: { ...body.input.data, name: "Corrected" } },
  });
  expect(corrected.statusCode, corrected.body).toBe(200);
  const legacyKey = `legacy:request.${randomUUID()}`;
  const legacyBody = call();
  expect((await settle(legacyKey, legacyBody)).json()).toEqual({
    key: legacyKey,
    outcome: "cancelled",
  });
  expect((await send(legacyKey, legacyBody)).json().code).toBe(
    "ATTEMPT_CANCELLED",
  );
  const interruptedKey = randomUUID(),
    interruptedBody = call();
  await expect(
    inWorkspace(db, workspace, async (tx) => {
      const ctx = await authorize(tx, actor, workspace, randomUUID());
      await settleIdempotent(
        tx,
        ctx,
        interruptedKey,
        "contacts.contacts.create",
        { moduleVersion: "1.1.0", input: interruptedBody },
      );
      throw Error("Interrupted settlement transaction");
    }),
  ).rejects.toThrow("Interrupted settlement transaction");
  const rolledBack = await inWorkspace(db, workspace, async (tx) => ({
    receipts: await tx
      .selectFrom("suite.idempotency")
      .selectAll()
      .where("key", "=", interruptedKey)
      .execute(),
    audits: await tx
      .selectFrom("suite.audit")
      .selectAll()
      .where("target_id", "=", interruptedKey)
      .execute(),
  }));
  expect(rolledBack).toEqual({ receipts: [], audits: [] });
  expect((await send(interruptedKey, interruptedBody)).statusCode).toBe(200);
});

it("serializes both race directions with real resource execution and preserves accepted receipts", async () => {
  for (const first of ["execute", "cancel"] as const) {
    const key = randomUUID(),
      body = call();
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstRequest = inWorkspace(db, workspace, async (tx) => {
      const ctx = await authorize(
        tx,
        actor,
        workspace,
        randomUUID(),
        "contacts.contacts.write",
        "contacts",
      );
      const input = { moduleVersion: "1.1.0", input: body };
      let result;
      if (first === "cancel")
        result = await settleIdempotent(
          tx,
          ctx,
          key,
          "contacts.contacts.create",
          input,
        );
      else
        result = await idempotent(
          tx,
          ctx,
          key,
          "contacts.contacts.create",
          input,
          async () =>
            executeResource(
              tx,
              ctx,
              "contacts",
              body,
              await workspaceModule(tx, workspace, "contacts"),
            ),
        );
      entered();
      await held;
      return result;
    });
    try {
      await Promise.race([
        ready,
        firstRequest.then(() => {
          throw Error("Expected held transaction");
        }),
      ]);
      const secondRequest =
        first === "execute" ? settle(key, body) : send(key, body);
      const lock = `${workspace}:${actor.id}:${key}`;
      await expect
        .poll(async () => {
          const waiting = await sql<{ waiting: boolean }>`select exists(
          select 1 from pg_locks where locktype='advisory' and not granted
          and classid::bigint=((hashtextextended(${lock},0) >> 32) & 4294967295)
          and objid::bigint=(hashtextextended(${lock},0) & 4294967295)
          and objsubid=1
        ) as waiting`.execute(db);
          return waiting.rows[0].waiting;
        })
        .toBe(true);
      release();
      const [, reply] = await Promise.all([firstRequest, secondRequest]);
      if (first === "execute") {
        expect(reply.statusCode, reply.body).toBe(200);
        expect(reply.json()).toMatchObject({
          key,
          outcome: "accepted",
          result: { id: body.input.id, data: body.input.data },
        });
        expect((await settle(key, body)).json()).toEqual(reply.json());
      } else expect(reply.json().code).toBe("ATTEMPT_CANCELLED");
      const count = await inWorkspace(db, workspace, (tx) =>
        tx
          .selectFrom("suite.module_records")
          .selectAll()
          .where("id", "=", body.input.id)
          .execute(),
      );
      expect(count).toHaveLength(first === "execute" ? 1 : 0);
    } finally {
      release();
      await firstRequest;
    }
  }
});

it("settles versioned custom commands and enforces current workspace, actor and resource authority", async () => {
  const key = randomUUID(),
    body = call();
  expect((await send(key, body)).statusCode).toBe(200);
  const operation = {
    action: "operation" as const,
    operation: "create-product",
    input: { sku: randomUUID(), name: "Never executed", priceMinor: 100 },
  };
  const operationKey = randomUUID();
  const cancelled = await settle(operationKey, operation, "inventory", "1.2.0");
  expect(cancelled.statusCode, cancelled.body).toBe(200);
  const late = await server.app.inject({
    method: "POST",
    url: `/api/v1/module/inventory/workspaces/${workspace}/operations/create-product`,
    headers: {
      ...headers,
      "x-module-version": "1.2.0",
      "idempotency-key": operationKey,
    },
    payload: operation.input,
  });
  expect(late.json().code).toBe("ATTEMPT_CANCELLED");
  const foreign = randomUUID();
  await inWorkspace(db, foreign, (tx) =>
    provisionWorkspace(tx, {
      id: foreign,
      userId: actor.id,
      name: "Foreign",
      kind: "company",
    }),
  );
  expect(
    (await settle(key, body, "contacts", "1.1.0", foreign)).json(),
  ).toEqual({ key, outcome: "cancelled" });
  expect((await settle(key, body)).json().outcome).toBe("accepted");
  const staleContext = await inWorkspace(db, workspace, (tx) =>
    authorize(tx, actor, workspace, randomUUID()),
  );
  const roles = await inWorkspace(db, workspace, (tx) =>
    tx.selectFrom("suite.roles").select(["id", "permissions"]).execute(),
  );
  try {
    await inWorkspace(db, workspace, async (tx) => {
      for (const role of roles)
        await tx
          .updateTable("suite.roles")
          .set({
            permissions: role.permissions.filter(
              (p) => p !== "contacts.contacts.read",
            ),
          })
          .where("id", "=", role.id)
          .execute();
    });
    await expect(
      inWorkspace(db, workspace, (tx) =>
        settleModuleAttempt(tx, staleContext, "contacts", "1.1.0", {
          key,
          call: body,
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    const absent = randomUUID();
    expect((await settle(key, body)).statusCode).toBe(403);
    expect((await settle(absent, body)).statusCode).toBe(403);
    const receipts = await inWorkspace(db, workspace, (tx) =>
      tx
        .selectFrom("suite.idempotency")
        .selectAll()
        .where("key", "=", absent)
        .execute(),
    );
    expect(receipts).toHaveLength(0);
  } finally {
    await inWorkspace(db, workspace, async (tx) => {
      for (const role of roles)
        await tx
          .updateTable("suite.roles")
          .set({ permissions: role.permissions })
          .where("id", "=", role.id)
          .execute();
    });
  }
});
