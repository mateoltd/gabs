import { randomUUID } from "node:crypto";
import { assertSchema, Type } from "@suite/module-sdk";
import {
  hostCapabilitySchemas,
  HostAuthorizationSchema,
} from "@suite/module-sdk/host-capabilities";
import type { LocalDesktopDeviceRequest } from "@suite/client";

const identifier = Type.String({ minLength: 1, maxLength: 100 });
const schema = Type.Object(
  {
    profileId: identifier,
    grantId: identifier,
    releaseDigest: Type.String({ pattern: "^(bundled:)?[a-f0-9]{64}$" }),
    kind: HostAuthorizationSchema.properties.kind,
    call: Type.Object(
      {
        moduleId: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }),
        moduleVersion: Type.String({ minLength: 1, maxLength: 40 }),
        capability: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }),
        input: Type.Unknown(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const failure = (message: string) =>
  Object.assign(Error(message), { code: "LOCAL_DEVICE_CHANGED" });
export class LocalDeviceSessions {
  private sessions = new Map<
    string,
    { request: LocalDesktopDeviceRequest; used: boolean; bytes: number }
  >();
  private checks = new Map<
    string,
    { handle: string; finish(error?: Error): void }
  >();
  constructor(
    private send: (handle: string, nonce: string) => void,
    private timeoutMs = 10000,
  ) {}
  open(value: unknown) {
    assertSchema(schema, value);
    assertSchema(hostCapabilitySchemas[value.kind].input, value.call.input);
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (
      this.sessions.size >= 16 ||
      [...this.sessions.values()].reduce((sum, s) => sum + s.bytes, bytes) >
        64 * 1024 * 1024
    )
      throw Error("Close an existing device request before opening another.");
    const handle = randomUUID();
    this.sessions.set(handle, {
      request: structuredClone(value),
      used: false,
      bytes,
    });
    return handle;
  }
  close(handle: string) {
    this.sessions.delete(handle);
    for (const check of this.checks.values())
      if (check.handle === handle)
        check.finish(failure("This local device session is no longer active."));
  }
  clear() {
    for (const handle of this.sessions.keys()) this.close(handle);
  }
  reply(handle: string, nonce: string, allowed: unknown, message?: unknown) {
    const check = this.checks.get(nonce);
    if (!check || check.handle !== handle) return;
    check.finish(
      allowed === true
        ? undefined
        : failure(
            typeof message === "string"
              ? message.slice(0, 500)
              : "The local profile did not authorize this device request.",
          ),
    );
  }
  async execute(
    handle: string,
    invoke: (
      request: LocalDesktopDeviceRequest,
      recheck: () => Promise<void>,
    ) => Promise<unknown>,
  ) {
    const session = this.sessions.get(handle);
    if (!session || session.used)
      throw failure("This device session is closed or has already been used.");
    session.used = true;
    const current = () => {
      if (this.sessions.get(handle) !== session)
        throw failure("This local device session is no longer active.");
    };
    const recheck = async () => {
      current();
      await new Promise<void>((resolve, reject) => {
        const nonce = randomUUID();
        const timer = setTimeout(
          () =>
            finish(
              failure(
                "The local profile did not respond. Unlock it and review the device request.",
              ),
            ),
          this.timeoutMs,
        );
        const finish = (error?: Error) => {
          if (!this.checks.delete(nonce)) return;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };
        this.checks.set(nonce, { handle, finish });
        try {
          this.send(handle, nonce);
        } catch {
          finish(failure("The local profile is unavailable."));
        }
      });
      current();
    };
    await recheck();
    const result = await invoke(structuredClone(session.request), recheck);
    assertSchema(hostCapabilitySchemas[session.request.kind].output, result);
    return result;
  }
}
