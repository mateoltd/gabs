import type { ModuleDefinition } from "./index";

export interface ClientViewBundle {
  format: "suite-view-v1";
  javascript: string;
  css: string;
}
export type ClientBundles = Record<string, ClientViewBundle>;

/** Transported contracts exclude executable payloads when matching a staged server. */
export function moduleContract(
  artifact: Record<string, unknown>,
): ModuleDefinition {
  const { client: _client, ...contract } = artifact;
  return contract as unknown as ModuleDefinition;
}

export function validateClientArtifacts(
  artifact: Record<string, unknown>,
): ClientBundles {
  const views = moduleContract(artifact).views ?? {};
  const client = artifact.client;
  if (client === undefined && !Object.keys(views).length) return {};
  if (!client || typeof client !== "object" || Array.isArray(client))
    throw Error(
      "Custom views require signed executable client bundles. Rebuild this module.",
    );
  const bundles = client as ClientBundles;
  if (Object.keys(bundles).length !== Object.keys(views).length)
    throw Error("Executable views do not match the declared module views.");
  let total = 0;
  for (const [name, value] of Object.entries(bundles)) {
    if (
      !Object.hasOwn(views, name) ||
      !value ||
      value.format !== "suite-view-v1"
    )
      throw Error(
        `Unsupported executable view contract: ${name}. Update the host or rebuild the module.`,
      );
    if (
      typeof value.javascript !== "string" ||
      !value.javascript.trim() ||
      typeof value.css !== "string"
    )
      throw Error(`Invalid executable view payload: ${name}`);
    const bytes = new TextEncoder().encode(value.javascript).byteLength;
    const cssBytes = new TextEncoder().encode(value.css).byteLength;
    if (bytes > 2 * 1024 * 1024 || cssBytes > 256 * 1024)
      throw Error(`View ${name} exceeds the supported bundle size.`);
    total += bytes + cssBytes;
  }
  if (total > 8 * 1024 * 1024)
    throw Error("Module client exceeds the supported package size.");
  return bundles;
}
