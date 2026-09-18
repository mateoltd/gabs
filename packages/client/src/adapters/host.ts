import { assertSchema, type ModuleDefinition } from "@suite/module-sdk";
import {
  createModuleHost,
  HostAuthorizationSchema,
  hostCapabilitySchemas,
  HostCapabilityError,
  type HostCapabilityCall,
} from "@suite/module-sdk/host-capabilities";
import { browserPlatform } from "./browser";
import type { Scope } from "../index";
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

/** Shared online host bridge for reviewed official views. Offline clients retain explicit lease handling. */
export function createOnlineModuleHost<M extends ModuleDefinition>(
  module: M,
  context: {
    client: import("../api").SuiteClient;
    scope: Scope;
    signal: AbortSignal;
    check(): void;
  },
) {
  const check = () => {
    context.signal.throwIfAborted();
    context.check();
  };
  return createModuleHost(module, async (call) => {
    check();
    const native = window.suiteDesktop;
    if (native) {
      const handle = await native.openModuleHost(
        context.scope,
        module.id,
        module.version,
      );
      const close = () => {
        void native.closeModuleHost(handle).catch(() => {});
      };
      context.signal.addEventListener("abort", close, { once: true });
      try {
        check();
        return await native.moduleCapability(
          handle,
          call.capability,
          call.input,
        );
      } finally {
        context.signal.removeEventListener("abort", close);
        await native.closeModuleHost(handle);
      }
    }
    const authorization = await context.client.request(
      {
        operation: "moduleCapabilityAuthorize",
        params: { workspaceId: context.scope.workspaceId, moduleId: module.id },
        moduleVersion: module.version,
        body: { capability: call.capability },
      },
      { signal: context.signal },
    );
    check();
    return executeWebHostCapability(authorization, call, context.scope);
  });
}
