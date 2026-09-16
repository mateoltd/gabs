// Generated reviewed server entry points. Never import this file into a renderer.
import type {
  ScopedModuleServer,
  TrustedModuleServer,
} from "@suite/module-sdk/server";
import type { Tx, Context } from "../../server-core/src";
import s0 from "../../../modules/inventory/module-server";
import s1 from "../../../modules/inventory/releases/1.1.0/module-server";
import s2 from "../../../modules/inventory/releases/2.0.0/module-server";
import s3 from "../../../modules/orders/module-server";
export const moduleServers: Array<
  ScopedModuleServer | TrustedModuleServer<{ tx: Tx; ctx: Context }>
> = [s0, s1, s2, s3];
const identities = new Set<string>();
for (const server of moduleServers) {
  const key = server.module.id + "@" + server.module.version;
  if (identities.has(key)) throw Error("Duplicate staged backend: " + key);
  identities.add(key);
}
