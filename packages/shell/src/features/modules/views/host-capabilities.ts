import { assertSchema } from "@suite/module-sdk";
import {
  HostAuthorizationSchema,
  hostCapabilitySchemas,
  HostCapabilityError,
  type HostCapabilityCall,
} from "@suite/module-sdk/host-capabilities";
import { browserPlatform } from "@suite/client/browser";
import type { Scope } from "@suite/client";
export async function executeWebHostCapability(
  authorization: unknown,
  call: HostCapabilityCall,
  scope: Scope,
) {
  assertSchema(HostAuthorizationSchema, authorization);
  if (
    authorization.userId !== scope.userId ||
    authorization.workspaceId !== scope.workspaceId ||
    authorization.moduleId !== call.moduleId ||
    authorization.moduleVersion !== call.moduleVersion ||
    authorization.capability !== call.capability
  )
    throw Error("The host authorization does not match this request.");
  const { kind } = authorization;
  assertSchema(hostCapabilitySchemas[kind].input, call.input);
  if (kind === "files.export") {
    const input = call.input as { filename: string; content: string };
    await browserPlatform.saveFile(input.filename, input.content);
    return { status: "offered" };
  }
  if (kind === "notifications.show") {
    const input = call.input as { title: string; message: string };
    if (!("Notification" in window) || Notification.permission !== "granted")
      return { requested: false };
    await browserPlatform.notify(input.title, input.message);
    return { requested: true };
  }
  throw new HostCapabilityError(
    "CAPABILITY_UNAVAILABLE",
    "This action requires the desktop application and an enabled local network.",
  );
}
