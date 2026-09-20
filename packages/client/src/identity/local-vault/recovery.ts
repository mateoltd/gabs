const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const states = new Set([
  "pending",
  "running",
  "completed",
  "rejected",
  "uncertain",
]);
function assertRecoveryDeviceRequest(
  id: string,
  value: unknown,
): asserts value is Record<string, unknown> & { id: string; state: string } {
  if (
    !object(value) ||
    value.id !== id ||
    typeof value.state !== "string" ||
    !states.has(value.state) ||
    typeof value.createdAt !== "number" ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    (value.attemptId !== undefined && typeof value.attemptId !== "string") ||
    typeof value.grantId !== "string" ||
    !value.grantId ||
    (value.retryOf !== undefined && typeof value.retryOf !== "string") ||
    (value.error !== undefined && typeof value.error !== "string") ||
    !object(value.call) ||
    typeof value.call.moduleId !== "string" ||
    !value.call.moduleId ||
    typeof value.call.moduleVersion !== "string" ||
    !value.call.moduleVersion ||
    typeof value.call.capability !== "string" ||
    !value.call.capability ||
    !Object.hasOwn(value.call, "input")
  )
    throw Error("The restored device journal is invalid.");
}

/** A backup may predate effects already performed by another device. Never replay them on unlock. */
export function recoveredLocalData(value: unknown) {
  if (
    !object(value) ||
    !object(value.records) ||
    !Object.values(value.records).every(Array.isArray) ||
    (value.deviceRequests !== undefined && !object(value.deviceRequests))
  )
    throw Error("The restored profile data is invalid.");
  const deviceRequests = Object.fromEntries(
    Object.entries(value.deviceRequests ?? {}).map(([id, request]) => {
      assertRecoveryDeviceRequest(id, request);
      return [
        id,
        request.state === "pending" || request.state === "running"
          ? {
              ...request,
              state: "uncertain" as const,
              error:
                "Restored from backup. Review whether the original device performed this action before retrying.",
            }
          : request,
      ];
    }),
  );
  return { ...value, capabilityGrants: [], deviceRequests };
}
