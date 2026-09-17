import { expect, it } from "vitest";
import { LocalDeviceSessions } from "../../apps/desktop/src/main/local-device-sessions";
import type { LocalDesktopDeviceRequest } from "../../packages/client/src/index";
const request: LocalDesktopDeviceRequest = {
  profileId: "profile",
  grantId: "grant",
  releaseDigest: "a".repeat(64),
  kind: "files.export",
  call: {
    moduleId: "device-notes",
    moduleVersion: "1.0.0",
    capability: "export",
    input: { filename: "notes.txt", content: "Private" },
  },
};
it("requires a fresh matching challenge, rejects reused handles and snapshots native input", async () => {
  const sent: { handle: string; nonce: string }[] = [];
  const sessions = new LocalDeviceSessions((handle, nonce) =>
    sent.push({ handle, nonce }),
  );
  const input = structuredClone(request);
  const handle = sessions.open(input);
  (input.call.input as { content: string }).content = "Changed";
  let effects = 0;
  const result = sessions.execute(handle, async (value, recheck) => {
    expect(value.call.input).toEqual({
      filename: "notes.txt",
      content: "Private",
    });
    await recheck();
    effects++;
    return { status: "saved" };
  });
  sessions.reply("foreign", sent[0].nonce, true);
  sessions.reply(handle, "wrong-nonce", true);
  expect(effects).toBe(0);
  sessions.reply(handle, sent[0].nonce, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sent).toHaveLength(2);
  sessions.reply(handle, sent[0].nonce, true);
  expect(effects).toBe(0);
  sessions.reply(handle, sent[1].nonce, true);
  await expect(result).resolves.toEqual({ status: "saved" });
  expect(effects).toBe(1);
  await expect(
    sessions.execute(handle, async () => ({ status: "saved" })),
  ).rejects.toThrow(/already been used/);
  sessions.clear();
});
it("closing or navigating invalidates waiting checks and late replies cannot authorize effects", async () => {
  for (const clear of [false, true]) {
    let sent: { handle: string; nonce: string } | undefined;
    const sessions = new LocalDeviceSessions((handle, nonce) => {
      sent = { handle, nonce };
    });
    const handle = sessions.open(request);
    const pending = sessions.execute(handle, async () => {
      throw Error("Must not invoke");
    });
    const rejected = expect(pending).rejects.toThrow(/no longer active/);
    if (clear) sessions.clear();
    else sessions.close(handle);
    sessions.reply(handle, sent!.nonce, true);
    await rejected;
  }
});
it("denial and bounded timeout reject before invocation, and malformed native inputs cannot open", async () => {
  let sessions: LocalDeviceSessions;
  sessions = new LocalDeviceSessions((handle, nonce) =>
    sessions.reply(handle, nonce, false, "Consent revoked"),
  );
  await expect(
    sessions.execute(sessions.open(request), async () => {
      throw Error("Must not invoke");
    }),
  ).rejects.toThrow("Consent revoked");
  const timeout = new LocalDeviceSessions(() => {}, 5);
  await expect(
    timeout.execute(timeout.open(request), async () => {
      throw Error("Must not invoke");
    }),
  ).rejects.toThrow(/did not respond/);
  expect(() =>
    sessions.open({
      ...request,
      call: {
        ...request.call,
        input: { filename: "../../private.txt", content: "Private" },
      },
    }),
  ).toThrow();
  expect(() =>
    sessions.open({ ...request, workspaceId: "corporate" }),
  ).toThrow();
  sessions.clear();
  timeout.clear();
});
