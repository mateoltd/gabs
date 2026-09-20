import type { LocalUnlockStatus, LocalVault } from "./contracts";
export type NativeVaultChange =
  | {
      session: string;
      id: string;
      generation: number;
    }
  | { closed: true; session: string };
export interface OpenedNativeVault {
  session: string;
  generation: number;
  handle: string;
  profile: { id: string; name: string };
  revision: number;
  data: unknown;
}
/** Only encrypted legacy envelopes may be imported; no encryption key appears in this protocol. */
export interface LocalVaultOperations {
  list: {
    input: { removed: boolean };
    output: { id: string; name: string; removedAt?: number }[];
  };
  create: {
    input: { name: string; password: string; data: unknown };
    output: OpenedNativeVault;
  };
  unlock: {
    input: { id: string; password: string };
    output: OpenedNativeVault;
  };
  restore: {
    input: { id: string; password: string };
    output: OpenedNativeVault;
  };
  quickUnlock: {
    input: { id: string; method: "pin" | "biometric"; pin: string };
    output: OpenedNativeVault;
  };
  status: { input: { id: string }; output: LocalUnlockStatus };
  configure: {
    input: { id: string; password: string; pin?: string; biometric: boolean };
    output: void;
  };
  remove: { input: { id: string }; output: void };
  assert: { input: { handle: string; revision: number }; output: void };
  commit: {
    input: { handle: string; revision: number; value: unknown };
    output: number;
  };
  close: { input: { handle: string }; output: void };
  import: { input: { vaults: LocalVault[] }; output: string[] };
}
export type LocalVaultRequest = {
  [K in keyof LocalVaultOperations]: {
    action: K;
    input: LocalVaultOperations[K]["input"];
  };
}[keyof LocalVaultOperations];
export interface NativeVaultBridge {
  request<K extends keyof LocalVaultOperations>(
    id: string,
    action: K,
    input: LocalVaultOperations[K]["input"],
  ): Promise<LocalVaultOperations[K]["output"]>;
  cancel(id: string): Promise<void>;
  subscribe(listener: (change: NativeVaultChange) => void): () => void;
}

/** The native boundary validates the discriminant and every authority-bearing field. */
export function assertLocalVaultRequest(
  value: unknown,
): asserts value is LocalVaultRequest {
  if (!value || typeof value !== "object")
    throw Error("Invalid local vault request.");
  const request = value as { action: unknown; input: unknown };
  if (
    typeof request.action !== "string" ||
    !request.input ||
    typeof request.input !== "object" ||
    Array.isArray(request.input)
  )
    throw Error("Invalid local vault request.");
  const input = request.input as Record<string, unknown>;
  const text = (key: string, max = 4096) =>
    typeof input[key] === "string" && (input[key] as string).length <= max;
  const id = (key: string) =>
    text(key, 36) &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
      input[key] as string,
    );
  const revision = () =>
    Number.isSafeInteger(input.revision) && (input.revision as number) >= 0;
  let valid = false;
  switch (request.action) {
    case "list":
      valid = typeof input.removed === "boolean";
      break;
    case "create":
      valid = text("name", 100) && text("password") && input.data !== undefined;
      break;
    case "unlock":
    case "restore":
      valid = id("id") && text("password");
      break;
    case "quickUnlock":
      valid =
        id("id") &&
        ["pin", "biometric"].includes(input.method as string) &&
        text("pin", 12);
      break;
    case "status":
    case "remove":
      valid = id("id");
      break;
    case "configure":
      valid =
        id("id") &&
        text("password") &&
        (input.pin === undefined || text("pin", 12)) &&
        typeof input.biometric === "boolean";
      break;
    case "assert":
      valid = id("handle") && revision();
      break;
    case "commit":
      valid = id("handle") && revision() && input.value !== undefined;
      break;
    case "close":
      valid = id("handle");
      break;
    case "import":
      valid = Array.isArray(input.vaults) && input.vaults.length <= 1000;
      break;
  }
  if (!valid) throw Error("Invalid local vault request.");
}
