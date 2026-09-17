import {
  assertSchema,
  hydrateModule,
  resourceRecordSchema,
  resourcePageSchema,
  ResourceResponseError,
  type ModuleCall,
  type ModuleDefinition,
} from "@suite/module-sdk";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import { verifyArtifact } from "@suite/module-sdk/verification";
import type { SignedArtifact } from "@suite/module-sdk/platform";
export interface ResponseContract {
  signed: SignedArtifact;
  publicKey: string;
}
export class ResponseContractUnavailable extends Error {
  readonly code = "MODULE_RESPONSE_CONTRACT_UNAVAILABLE";
  constructor() {
    super(
      "The original signed module version is unavailable. Restore that version before synchronizing this change.",
    );
  }
}
export const responseContractKey = (call: ModuleCall) =>
  `${call.moduleId}@${call.moduleVersion ?? ""}`;
export async function verifyResponseContract(
  contract: ResponseContract | undefined,
  call: ModuleCall,
) {
  if (
    !contract ||
    !call.moduleVersion ||
    contract.signed.module_id !== call.moduleId ||
    contract.signed.version !== call.moduleVersion
  )
    throw new ResponseContractUnavailable();
  try {
    await verifyArtifact(contract.signed, contract.publicKey);
    const module = hydrateModule(moduleContract(contract.signed.artifact));
    if (
      !call.resource ||
      !Object.hasOwn(module.resources, call.resource) ||
      !["get", "list", "create", "update", "archive"].includes(call.action)
    )
      throw new ResponseContractUnavailable();
    return module;
  } catch (cause) {
    throw new ResponseContractUnavailable();
  }
}
export function validateModuleResponse(
  module: ModuleDefinition,
  call: ModuleCall,
  result: unknown,
) {
  const definition =
    call.resource && Object.hasOwn(module.resources, call.resource)
      ? module.resources[call.resource]
      : undefined;
  if (
    module.id !== call.moduleId ||
    module.version !== call.moduleVersion ||
    !definition ||
    !["get", "list", "create", "update", "archive"].includes(call.action)
  )
    throw new ResponseContractUnavailable();
  try {
    assertSchema(
      call.action === "list"
        ? resourcePageSchema(definition.schema)
        : resourceRecordSchema(definition.schema),
      result,
    );
  } catch (cause) {
    throw new ResourceResponseError(
      module.id,
      call.resource!,
      call.action,
      call.key,
      cause,
    );
  }
}
