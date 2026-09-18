import { assertSchema, Type } from "@suite/module-sdk";
import { hostCapabilitySchemas } from "@suite/module-sdk/host-capabilities";
import type { Scope } from "@suite/client";
import type { OperationRequest } from "@suite/contracts";

/** Host-owned background export delivery. CSV bytes and authority never come from the renderer. */
export async function downloadExport(
  scope: Scope,
  id: string,
  host: {
    check(): void;
    request(
      request: OperationRequest,
    ): Promise<{ status: number; body: unknown }>;
    choose(filename: string): Promise<string | undefined>;
    write(path: string, content: string): Promise<void>;
  },
): Promise<{ status: "saved" | "cancelled" }> {
  assertSchema(
    Type.String({
      pattern:
        "^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
    }),
    id,
  );
  const request = async (operation: "exportAuthorize" | "exportDownload") => {
    host.check();
    const reply = await host.request({
      operation,
      params: { workspaceId: scope.workspaceId, id },
    });
    host.check();
    if (reply.status !== 200)
      throw Error(
        (reply.body as { message?: string })?.message ??
          "This export is no longer available.",
      );
    return reply.body;
  };
  const metadata = await request("exportAuthorize");
  assertSchema(
    Type.Object(
      { filename: Type.Literal(`orders-${id}.csv`) },
      { additionalProperties: false },
    ),
    metadata,
  );
  const path = await host.choose(metadata.filename);
  host.check();
  if (!path) return { status: "cancelled" };
  // Current permission, assignment and job ownership are checked after the OS dialog.
  const file = await request("exportDownload");
  assertSchema(hostCapabilitySchemas["files.export"].input, file);
  if (file.filename !== metadata.filename)
    throw Error("The export identity changed while saving.");
  host.check();
  await host.write(path, file.content);
  return { status: "saved" };
}
