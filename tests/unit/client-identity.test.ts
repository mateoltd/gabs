import { expect, it, vi } from "vitest";
import {
  SuiteClient,
  httpTransport,
  type Transport,
} from "../../packages/client/src/api";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
const identity = (id: string) => ({
  status: 200,
  actorId: id,
  body: { user: { id }, csrfToken: id },
});
it("binds workspace transport to its original profile and rejects a different authenticated actor", async () => {
  let actor = A;
  const transport = vi.fn<Transport>(async (request) =>
    request.operation === "me"
      ? identity(actor)
      : { status: 200, actorId: actor, body: { ok: true } },
  );
  const client = new SuiteClient(transport),
    locked: string[] = [];
  client.onIdentityInvalidated(async (event) => {
    locked.push(event.userId);
  });
  await client.request({ operation: "me" });
  const bound = client.forUser(A);
  actor = B;
  await expect(
    bound.request({ operation: "bootstrap", params: { workspaceId: A } }),
  ).rejects.toMatchObject({ code: "PROFILE_CHANGED" });
  expect(transport.mock.calls.at(-1)?.[0].expectedUserId).toBe(A);
  expect(locked).toEqual([A]);
  await client.request({ operation: "me" });
  const calls = transport.mock.calls.length;
  await expect(
    bound.request({ operation: "bootstrap", params: { workspaceId: A } }),
  ).rejects.toMatchObject({ code: "PROFILE_CHANGED" });
  expect(transport).toHaveBeenCalledTimes(calls);
});
it("rejects a reply started before identity changed even when it carries the old correct actor", async () => {
  let actor = A,
    release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = new SuiteClient(async (request) => {
    if (request.operation === "me") return identity(actor);
    await held;
    return { status: 200, actorId: A, body: { ok: true } };
  });
  await client.request({ operation: "me" });
  const pending = client
    .forUser(A)
    .request({ operation: "bootstrap", params: { workspaceId: A } });
  const rejected = expect(pending).rejects.toMatchObject({
    code: "PROFILE_CHANGED",
  });
  actor = B;
  await client.request({ operation: "me" });
  release();
  await rejected;
  expect(client.isCurrentUser(B)).toBe(true);
});
it("does not accept missing actor evidence or overwrite a newer me reply", async () => {
  let first!: (value: ReturnType<typeof identity>) => void;
  let count = 0;
  const client = new SuiteClient(async (request) => {
    if (request.operation !== "me") return { status: 200, body: {} };
    if (++count === 1)
      return new Promise((resolve) => {
        first = resolve;
      });
    return identity(B);
  });
  const old = client.request({ operation: "me" });
  const rejected = expect(old).rejects.toMatchObject({
    code: "PROFILE_CHANGED",
  });
  await client.request({ operation: "me" });
  first(identity(A));
  await rejected;
  await expect(
    client
      .forUser(B)
      .request({ operation: "bootstrap", params: { workspaceId: A } }),
  ).rejects.toMatchObject({ code: "IDENTITY_UNVERIFIED" });
  expect(client.isCurrentUser(B)).toBe(true);
});
it("sends and preserves authenticated actor evidence through HTTP", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { "X-Suite-Actor": A },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  try {
    expect(
      await httpTransport()({
        operation: "bootstrap",
        params: { workspaceId: B },
        expectedUserId: A,
      }),
    ).toMatchObject({ actorId: A });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { "X-Suite-Actor": A },
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("ignores duplicate and old-account invalidations without clearing a newer identity", async () => {
  let actor = A;
  const client = new SuiteClient(async () => identity(actor));
  const invalidated = vi.fn(async () => {});
  client.onIdentityInvalidated(invalidated);
  await client.request({ operation: "me" });
  await client.invalidateIdentity(A);
  await client.invalidateIdentity(A, true);
  expect(invalidated).toHaveBeenCalledTimes(1);
  actor = B;
  await client.request({ operation: "me" });
  await client.invalidateIdentity(A, true);
  expect(client.isCurrentUser(B)).toBe(true);
  expect(invalidated).toHaveBeenCalledTimes(1);
});

it("keeps a public connectivity probe valid across identity observations", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = new SuiteClient(async (request) => {
    if (request.operation === "me") return identity(A);
    await held;
    return { status: 200, body: { ok: true } };
  });
  const probe = client.request({ operation: "connection" });
  await client.request({ operation: "me" });
  release();
  await expect(probe).resolves.toEqual({ ok: true });
});

it.each([A, B])(
  "reconciles an early restored-profile request with first authentication as %s",
  async (actor) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = new SuiteClient(async (request) => {
      if (request.operation === "me") return identity(actor);
      await held;
      return { status: 200, actorId: A, body: { ok: true } };
    });
    const pending = client
      .forUser(A)
      .request({ operation: "bootstrap", params: { workspaceId: A } });
    const outcome =
      actor === A
        ? expect(pending).resolves.toEqual({ ok: true })
        : expect(pending).rejects.toMatchObject({ code: "PROFILE_CHANGED" });
    await client.request({ operation: "me" });
    release();
    await outcome;
    expect(client.isCurrentUser(actor)).toBe(true);
  },
);
