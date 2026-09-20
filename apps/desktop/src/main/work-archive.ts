import { randomUUID } from "node:crypto";
import { open, link, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertSchema, Type } from "@suite/module-sdk";
import {
  parseSavedWorkArchive,
  sealSavedWorkArchive,
} from "@suite/client/work-archive";
import type { Scope } from "@suite/client";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";

interface ArchiveSession {
  scope: Scope;
  moduleId: string;
  moduleVersion: string;
  check(): void;
}

/** Main owns authority and disk delivery. Renderer input cannot supply a path or a pre-encrypted bypass. */
export async function exportNativeWorkArchive(options: {
  handle: unknown;
  content: unknown;
  passphrase: unknown;
  capture(handle: string): ArchiveSession;
  check(): void;
  authorize(
    scope: Scope,
    input: SavedWorkRecovery,
    check: () => void,
  ): Promise<() => void>;
  choose(filename: string): Promise<string | undefined>;
}) {
  options.check();
  assertSchema(Type.String({ minLength: 1, maxLength: 128 }), options.handle);
  assertSchema(
    Type.String({ minLength: 12, maxLength: 1024 }),
    options.passphrase,
  );
  if (typeof options.content !== "string")
    throw Error("Invalid saved-work archive.");
  const session = options.capture(options.handle);
  const scope = session.scope;
  const archive = parseSavedWorkArchive(options.content, scope);
  if (
    !archive.copies.some(
      (input) =>
        input.moduleId === session.moduleId &&
        input.moduleVersion === session.moduleVersion,
    )
  )
    throw Error("The archive does not contain its owning recovery session.");
  const lifecycle = () => {
    options.check();
    session.check();
  };
  let authorities: (() => void)[] = [];
  const check = () => {
    lifecycle();
    for (const guard of authorities) guard();
  };
  const authorize = async () => {
    const next: (() => void)[] = [];
    for (const input of archive.copies) {
      lifecycle();
      next.push(await options.authorize(scope, input, lifecycle));
    }
    authorities = next;
    check();
  };
  await authorize();
  const encrypted = await sealSavedWorkArchive(
    archive,
    options.passphrase,
    check,
  );
  const selected = await options.choose(
    `saved-work-archive-${randomUUID()}.json`,
  );
  check();
  if (!selected) return { status: "cancelled" as const };
  await authorize();
  const destination = resolve(selected);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(encrypted, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    check();
    // Publish atomically without truncating an existing backup, even after a crash.
    await link(temporary, destination);
    if (process.platform !== "win32") {
      const directory = await open(dirname(destination), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return { status: "saved" as const };
  } finally {
    await rm(temporary, { force: true });
  }
}
