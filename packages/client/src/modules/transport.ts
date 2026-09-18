import type { ModuleCall, ModuleRequestOptions } from "@suite/module-sdk";
import type { ReferenceQuery } from "@suite/module-sdk/references";
import type { SuiteClient } from "../api";
import type { Scope } from "../index";

/** Preserve the original operation, version and retry key across every host. */
export function sendModuleCall(
  client: SuiteClient,
  scope: Pick<Scope, "workspaceId">,
  call: ModuleCall,
  options?: ModuleRequestOptions,
): Promise<unknown> {
  const params = { workspaceId: scope.workspaceId, moduleId: call.moduleId };
  if (call.action === "references")
    return client.request(
      {
        operation: "moduleReferences",
        params: { ...params, resource: call.resource! },
        query: call.input as ReferenceQuery,
        moduleVersion: call.moduleVersion,
      },
      options,
    );
  if (call.action === "operation") {
    if (!call.operation) throw Error("The operation name is required.");
    return client.request(
      {
        operation: call.kind === "query" ? "moduleQuery" : "moduleOperation",
        params: { ...params, operationName: call.operation },
        body: call.input,
        idempotencyKey: call.key,
        moduleVersion: call.moduleVersion,
      },
      options,
    );
  }
  return client.request(
    {
      operation: "moduleRequest",
      params,
      body: { action: call.action, resource: call.resource, input: call.input },
      idempotencyKey: call.key,
      moduleVersion: call.moduleVersion,
    },
    options,
  );
}
