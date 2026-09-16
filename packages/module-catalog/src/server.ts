// Generated reviewed server entry points. Never import this file into a renderer.
import type {
  ScopedModuleServer,
  TrustedModuleServer,
} from "@suite/module-sdk/server";
import type { Tx, Context } from "../../server-core/src";
import s0 from "../../../modules/inventory/module-server";
import s1 from "../../../modules/inventory/releases/1.1.0/module-server";
import s2 from "../../../modules/inventory/releases/1.2.0/module-server";
import s3 from "../../../modules/inventory/releases/2.0.0/module-server";
import s4 from "../../../modules/orders/module-server";
import s5 from "../../../modules/orders/releases/1.1.0/module-server";
import s6 from "../../../modules/orders/releases/2.0.0/module-server";
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
