import { canonical } from "./registry";
import {
  validateClientArtifacts,
  verifyClientRequirements,
} from "./client-artifact";
import { validateLocalArtifact } from "./local-artifact";
import type { SignedArtifact } from "./platform";
export async function verifyArtifact(pkg: SignedArtifact, pem: string) {
  const hex = (bytes: ArrayBuffer) =>
    Array.from(new Uint8Array(bytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const bytes = new TextEncoder().encode(canonical(pkg.artifact));
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== pkg.digest)
    throw Error("Module checksum verification failed.");
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----|\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  if (hex(await crypto.subtle.digest("SHA-256", der)) !== pkg.key_id)
    throw Error("Untrusted module signing key.");
  const key = await crypto.subtle.importKey(
    "spki",
    der,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      key,
      Uint8Array.from(atob(pkg.signature), (c) => c.charCodeAt(0)),
      new TextEncoder().encode(
        canonical({ manifest: pkg.manifest, digest: pkg.digest }),
      ),
    ))
  )
    throw Error("Module signature verification failed.");
  if (
    pkg.manifest.id !== pkg.module_id ||
    pkg.manifest.version !== pkg.version ||
    pkg.artifact.id !== pkg.module_id ||
    pkg.artifact.version !== pkg.version ||
    pkg.manifest.publisher !== "suite" ||
    pkg.artifact.publisher !== pkg.manifest.publisher
  )
    throw Error("Module identity verification failed.");
  validateClientArtifacts(pkg.artifact);
  verifyClientRequirements(pkg.artifact, pkg.manifest);
  validateLocalArtifact(pkg.artifact);
}
