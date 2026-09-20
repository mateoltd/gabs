import type { LocalData } from "../local-profiles";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** A backup may predate effects already performed by another device. Never replay them on unlock. */
export function recoveredLocalData(value: unknown): LocalData {
  if (
    !object(value) ||
    !object(value.records) ||
    (value.deviceRequests !== undefined && !object(value.deviceRequests))
  )
    throw Error("The restored profile data is invalid.");
  const data = value as unknown as LocalData;
  const deviceRequests = Object.fromEntries(
    Object.entries(data.deviceRequests ?? {}).map(([id, request]) => {
      if (
        !object(request) ||
        request.id !== id ||
        !["pending", "running", "completed", "rejected", "uncertain"].includes(
          request.state,
        )
      )
        throw Error("The restored device journal is invalid.");
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
  return { ...data, capabilityGrants: [], deviceRequests };
}
