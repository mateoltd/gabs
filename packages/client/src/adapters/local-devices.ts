import { assertSchema } from "@suite/module-sdk";
import {
  hostCapabilitySchemas,
  HostCapabilityError,
} from "@suite/module-sdk/host-capabilities";
import type { LocalDeviceExecutor } from "../identity/local-devices";
import { browserPlatform } from "./browser";

/** Only the trusted profile host supplies the live guard; modules submit queued requests. */
export const executeLocalDevice: LocalDeviceExecutor = async (
  guard,
  signal,
) => {
  await guard.assertCurrent();
  const kind = guard.authorization.kind;
  assertSchema(hostCapabilitySchemas[kind].input, guard.call.input);
  const native = window.suiteDesktop;
  if (native) {
    const handle = await native.openLocalDevice(
      {
        profileId: guard.authorization.profileId,
        grantId: guard.authorization.id,
        releaseDigest: guard.authorization.releaseDigest,
        kind,
        call: guard.call,
      },
      () => guard.assertCurrent(),
    );
    const close = () => {
      void native.closeLocalDevice(handle).catch(() => {});
    };
    signal.addEventListener("abort", close, { once: true });
    try {
      await guard.assertCurrent();
      return await native.executeLocalDevice(handle);
    } finally {
      signal.removeEventListener("abort", close);
      await native.closeLocalDevice(handle).catch(() => {});
    }
  }
  if (kind === "files.export") {
    const input = guard.call.input as { filename: string; content: string };
    await guard.assertCurrent();
    await browserPlatform.saveFile(input.filename, input.content);
    return { status: "offered" };
  }
  if (kind === "notifications.show") {
    if (!("Notification" in window)) return { requested: false };
    if (Notification.permission === "default")
      await Notification.requestPermission();
    await guard.assertCurrent();
    if (Notification.permission !== "granted") return { requested: false };
    const input = guard.call.input as { title: string; message: string };
    await browserPlatform.notify(input.title, input.message);
    return { requested: true };
  }
  throw new HostCapabilityError(
    "CAPABILITY_UNAVAILABLE",
    "Local network actions require the desktop application and an authorized corporate workspace.",
  );
};
