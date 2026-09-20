import { sql } from "kysely";
import { connectDatabase } from "@suite/server-core";
import { runBatch } from "./worker";
const db = connectDatabase(
  process.env.WORKER_DATABASE_URL ??
    process.env.DATABASE_URL?.replace("suite_app:", "suite_worker:"),
);
let stop = false,
  lastHealth = 0;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    stop = true;
  });
while (!stop) {
  try {
    const count = await runBatch(db);
    if (Date.now() - lastHealth > 60000) {
      const health = await sql`select * from suite.job_health()`.execute(db);
      console.log(
        JSON.stringify({ event: "job_health", ...(health.rows[0] as object) }),
      );
      const integrity =
        await sql`select * from suite.integrity_health()`.execute(db);
      console.log(
        JSON.stringify({
          event: "integrity_health",
          ...(integrity.rows[0] as object),
        }),
      );
      lastHealth = Date.now();
    }
    if (count) console.log(JSON.stringify({ event: "jobs_processed", count }));
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "worker_error",
        code: (e as { code?: string }).code ?? "UNAVAILABLE",
      }),
    );
  }
  await new Promise((r) => setTimeout(r, 1000));
}
await db.destroy();
