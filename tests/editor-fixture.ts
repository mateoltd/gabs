import "dotenv/config";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { defineModule, resource, field, Type } from "@suite/module-sdk";
import { signPackage } from "../packages/module-sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  publishRelease,
} from "../tooling/registry-review";

/** Exercise the same reviewed schema changes through browser and native hosts. */
export async function publishEditorFixture(
  registry: Pool,
  id: string,
  name: string,
) {
  const directory =
    process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
  const privateKey = await readFile(`${directory}/private.pem`, "utf8"),
    publicKey = await readFile(`${directory}/public.pem`, "utf8");
  for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
    const module = defineModule({
      id,
      name,
      version,
      description: "Editor handoff acceptance",
      host: "^1.0.0",
      backend: "^1.0.0",
      publisher: "suite",
      dependencies: {},
      configuration: Type.Object({}),
      permissions: [
        `${id}.notes.read`,
        `${id}.notes.write`,
        `${id}.other.read`,
        `${id}.other.write`,
      ],
      operations: {},
      navigation: { path: `/${id}`, permission: `${id}.notes.read` },
      resources: {
        other: resource({ name: field.text() }, { title: "Other" }),
        ...(version === "1.2.0"
          ? {}
          : {
              notes: resource(
                version === "1.0.0"
                  ? { name: field.text(), legacy: field.text() }
                  : {
                      name: field.text(),
                      category: field.text({ minLength: 1 }),
                    },
                { title: "Notes" },
              ),
            }),
      },
    });
    const submission = await submitRelease(
      registry,
      signPackage(module, privateKey),
      null,
      publicKey,
    );
    await reviewRelease(
      registry,
      submission,
      "approved",
      "Reviewed editor update fixture",
      publicKey,
    );
    await publishRelease(registry, submission, publicKey);
  }
}
