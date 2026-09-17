import { Session } from "node:inspector/promises";
import { mkdir, writeFile } from "node:fs/promises";
import type { Logger } from "kysely";

/** Opt-in fixture diagnostics. Never record SQL parameters or expose an inspector port. */
export function createLoadDiagnostics(
  phase: "reads" | "confirmations" = "reads",
) {
  const directory = "docs/verification/load-diagnostics";
  const session = new Session();
  const queries = new Map<
    string,
    { count: number; totalMs: number; maxMs: number }
  >();
  let recording = false;
  let connected = false;
  const log: Logger = (event) => {
    if (!recording || event.level !== "query") return;
    const row = queries.get(event.query.sql) ?? {
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };
    row.count++;
    row.totalMs += event.queryDurationMillis;
    row.maxMs = Math.max(row.maxMs, event.queryDurationMillis);
    queries.set(event.query.sql, row);
  };
  return {
    directory,
    log,
    async start() {
      session.connect();
      connected = true;
      await session.post("Profiler.enable");
      await session.post("Profiler.setSamplingInterval", { interval: 500 });
      await session.post("Profiler.start");
      recording = true;
    },
    async stop() {
      if (!connected) return;
      recording = false;
      try {
        const { profile } = await session.post("Profiler.stop");
        await mkdir(directory, { recursive: true });
        await writeFile(
          `${directory}/${phase}.cpuprofile`,
          JSON.stringify(profile),
        );
        await writeFile(
          `${directory}/${phase === "reads" ? "queries" : "confirmation-queries"}.json`,
          JSON.stringify(
            [...queries]
              .map(([sql, times]) => ({ sql, ...times }))
              .sort((a, b) => b.totalMs - a.totalMs),
            null,
            2,
          ) + "\n",
        );
      } finally {
        session.disconnect();
        connected = false;
      }
    },
  };
}
