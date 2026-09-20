import { canonical } from "@suite/module-sdk/registry";
import type { LocalVault } from "./contracts";

/** Stable migration identity includes encrypted bytes and every credential/policy field. */
export function vaultEnvelope(vault: LocalVault): string {
  return canonical(
    JSON.parse(
      JSON.stringify(vault, (_key, value: unknown) => {
        if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
          const bytes =
            value instanceof ArrayBuffer ? new Uint8Array(value) : value;
          const chunks: string[] = [];
          for (let index = 0; index < bytes.length; index += 16384)
            chunks.push(
              String.fromCharCode(...bytes.subarray(index, index + 16384)),
            );
          return {
            binary: btoa(chunks.join("")),
            kind: value instanceof ArrayBuffer ? "buffer" : "bytes",
          };
        }
        return value;
      }),
    ),
  );
}
