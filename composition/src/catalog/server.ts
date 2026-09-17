// Generated reviewed server entry points. Never import this file into a renderer.
import type {
  ScopedModuleServer,
  TrustedModuleServer,
} from "@suite/module-sdk/server";
import type { Tx, Context } from "@suite/server-core";
import s0 from "@suite/inventory/module-server";
import s1 from "@suite/inventory/releases/1.1.0/module-server";
import s2 from "@suite/inventory/releases/1.2.0/module-server";
import s3 from "@suite/inventory/releases/2.0.0/module-server";
import s4 from "@suite/orders/module-server";
import s5 from "@suite/orders/releases/1.1.0/module-server";
import s6 from "@suite/orders/releases/2.0.0/module-server";
const staged: Array<
  ScopedModuleServer | TrustedModuleServer<{ tx: Tx; ctx: Context }>
> = [s0, s1, s2, s3, s4, s5, s6];
const identities = new Map<string, (typeof staged)[number]>();
for (const server of staged) {
  const key = server.module.id + "@" + server.module.version;
  const previous = identities.get(key);
  if (previous && previous !== server)
    throw Error("Duplicate staged backend: " + key);
  identities.set(key, server);
}
export const moduleServers = [...identities.values()];
