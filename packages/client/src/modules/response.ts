import type { ModuleStorage } from "./storage";
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
    const operation =
      call.action === "operation" &&
      call.operation &&
      !call.resource &&
      !call.kind &&
      Object.hasOwn(module.operations, call.operation) &&
      module.operations[call.operation].kind !== "query";
    const resource =
      call.resource &&
      Object.hasOwn(module.resources, call.resource) &&
      ["get", "list", "create", "update", "archive"].includes(call.action);
    if (!operation && !resource) throw new ResponseContractUnavailable();
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
  const operation =
    call.action === "operation" &&
    call.operation &&
    !call.resource &&
    !call.kind &&
    Object.hasOwn(module.operations, call.operation)
      ? module.operations[call.operation]
      : undefined;
  if (
    module.id !== call.moduleId ||
    module.version !== call.moduleVersion ||
    (!(operation && operation.kind !== "query") &&
      (!definition ||
        !["get", "list", "create", "update", "archive"].includes(call.action)))
  )
    throw new ResponseContractUnavailable();
  try {
    assertSchema(
      operation
        ? operation.output
        : call.action === "list"
          ? resourcePageSchema(definition!.schema)
          : resourceRecordSchema(definition!.schema),
      result,
    );
  } catch (cause) {
    throw new ResourceResponseError(
      module.id,
      call.resource ?? call.operation!,
      call.action,
      call.key,
      cause,
    );
  }
}

export async function responseContract(state: ModuleStorage, call: ModuleCall) {
  const installed = state.installed[call.moduleId];
  const candidates = [
    state.responseContracts?.[responseContractKey(call)],
    installed?.signed && installed.publicKey
      ? { signed: installed.signed, publicKey: installed.publicKey }
      : undefined,
  ];
  for (const contract of candidates) {
    if (!contract) continue;
    try {
      return { contract, module: await verifyResponseContract(contract, call) };
    } catch {
      // A repaired installation may restore this exact signed version.
    }
  }
  throw new ResponseContractUnavailable();
}

/** A malformed declared error is an unverifiable reply, not proof of rejection. */
export function validateModuleError(
  module: ModuleDefinition,
  call: ModuleCall,
  error: unknown,
) {
  const failure = error as {
    code?: string;
    detail?: { moduleId?: string; operation?: string; error?: unknown };
  } | null;
  if (failure?.code !== "MODULE_BUSINESS_ERROR") return;
  const operation =
    call.operation && Object.hasOwn(module.operations, call.operation)
      ? module.operations[call.operation]
      : undefined;
  try {
    if (
      call.action !== "operation" ||
      !operation?.errors ||
      failure.detail?.moduleId !== module.id ||
      failure.detail.operation !== call.operation
    )
      throw Error("The declared error belongs to a different operation.");
    assertSchema(operation.errors, failure.detail.error);
  } catch (cause) {
    throw new ResourceResponseError(
      module.id,
      call.operation ?? "",
      call.action,
      call.key,
      cause,
    );
  }
}
