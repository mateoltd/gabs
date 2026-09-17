import type { SuiteClient } from "@suite/client/api";
import type { LocalSession } from "@suite/client/local-profiles";

export interface LocalRegistry {
  client: SuiteClient;
  userId: string;
  workspaceId: string;
  online: boolean;
}

/** Each complete verified release is durable before the next request starts. */
export async function resumeLocalDownload(
  session: LocalSession,
  id: string,
  registry: LocalRegistry | undefined,
  signal: AbortSignal,
  changed: () => void = () => {},
) {
  const download = session.data.downloads?.[id];
  if (!download) throw Error("This saved download is no longer available.");
  const missing = download.modules.filter((m) => !m.release);
  if (!missing.length) return;
  if (!registry?.online)
    throw Error(
      "Reconnect to finish this download. Verified releases are saved in this profile.",
    );
  if (
    registry.userId !== download.source.userId ||
    registry.workspaceId !== download.source.workspaceId
  )
    throw Error(
      "Sign in to the original account and personal workspace to finish this download.",
    );
  const trust = await registry.client.request(
    { operation: "moduleTrust" },
    { signal },
  );
  for (const module of missing) {
    signal.throwIfAborted();
    const pkg = await registry.client.request(
      {
        operation: "moduleArtifact",
        params: {
          workspaceId: registry.workspaceId,
          moduleId: module.moduleId,
        },
      },
      { signal },
    );
    await session.saveDownload(id, pkg, trust.publicKey, { signal });
    changed();
  }
}
