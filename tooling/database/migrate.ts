import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
if (!process.env.MIGRATION_DATABASE_URL)
  throw Error("MIGRATION_DATABASE_URL is required");
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(739241)");
  if (process.env.NODE_ENV !== "production") {
    for (const role of ["suite_app", "suite_worker"]) {
      const exists = await client.query(
        "SELECT 1 FROM pg_roles WHERE rolname=$1",
        [role],
      );
      if (!exists.rowCount)
        await client.query(
          `CREATE ROLE ${role} LOGIN PASSWORD 'suite_local' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
        );
    }
  }
  await client.query(
    "CREATE TABLE IF NOT EXISTS public.suite_migrations(name text PRIMARY KEY,checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("packages/server/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const source = await readFile("packages/server/migrations/" + name, "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const existing = await client.query(
      "SELECT checksum FROM public.suite_migrations WHERE name=$1",
      [name],
    );
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum)
        throw Error(`Applied migration modified: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(source);
      await client.query(
        "INSERT INTO public.suite_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      await client.query("COMMIT");
      console.log("Applied", name);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(739241)");
  client.release();
  await pool.end();
}
