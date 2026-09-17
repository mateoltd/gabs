import { randomUUID } from "node:crypto";
import { assertSchema, Type } from "@suite/module-sdk";
import {
  hostCapabilitySchemas,
  HostAuthorizationSchema,
  type HostCapabilityCall,
  type HostAuthorization,
} from "@suite/module-sdk/host-capabilities";
import type { Scope } from "@suite/client";
const Identity = Type.Object(
  {
    userId: Type.String({ minLength: 1 }),
    workspaceId: Type.String({ minLength: 1 }),
    moduleId: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }),
    moduleVersion: Type.String({ minLength: 1, maxLength: 40 }),
  },
  { additionalProperties: false },
);
interface Context {
  scope: Scope;
  moduleId: string;
  moduleVersion: string;
}
export class ModuleHostSessions {
  private sessions = new Map<string, Context>();
  constructor(private currentUser: () => string | undefined) {}
  open(scope: Scope, moduleId: string, moduleVersion: string) {
    assertSchema(Identity, { ...scope, moduleId, moduleVersion });
    if (scope.userId !== this.currentUser())
      throw Error("This profile is no longer active.");
    if (this.sessions.size >= 16)
      throw Error(
        "Close an existing module view before opening another host session.",
      );
    const handle = randomUUID();
    this.sessions.set(handle, { scope: { ...scope }, moduleId, moduleVersion });
    return handle;
  }
  close(handle: string) {
    this.sessions.delete(handle);
  }
  clear() {
    this.sessions.clear();
  }
  async execute(
    handle: string,
    capability: string,
    input: unknown,
    host: {
      authorize: (scope: Scope, call: HostCapabilityCall) => Promise<unknown>;
      invoke: (
        authorization: HostAuthorization,
        input: unknown,
        recheck: () => Promise<void>,
      ) => Promise<unknown>;
    },
  ) {
    if (
      typeof capability !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(capability)
    )
      throw Error("Invalid host capability name.");
    const context = this.sessions.get(handle);
    const check = () => {
      if (
        !context ||
        this.sessions.get(handle) !== context ||
        context.scope.userId !== this.currentUser()
      )
        throw Error("This module host session is no longer active.");
      return context;
    };
    const selected = check();
    const call = {
      moduleId: selected.moduleId,
      moduleVersion: selected.moduleVersion,
      capability,
      input,
    };
    const authorize = async () => {
      check();
      const reply = await host.authorize(selected.scope, call);
      check();
      assertSchema(HostAuthorizationSchema, reply);
      if (
        reply.userId !== selected.scope.userId ||
        reply.workspaceId !== selected.scope.workspaceId ||
        reply.moduleId !== call.moduleId ||
        reply.moduleVersion !== call.moduleVersion ||
        reply.capability !== capability
      )
        throw Error("The host authorization does not match this request.");
      assertSchema(hostCapabilitySchemas[reply.kind].input, input);
      return reply;
    };
    const authorization = await authorize();
    const result = await host.invoke(authorization, input, async () => {
      const current = await authorize();
      if (current.kind !== authorization.kind)
        throw Error("The host capability changed while this action was open.");
    });
    assertSchema(hostCapabilitySchemas[authorization.kind].output, result);
    return result;
  }
}
