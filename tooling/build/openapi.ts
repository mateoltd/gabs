import { mkdir, writeFile } from "node:fs/promises";
import { createApp } from "@suite/api";
const { app, db } = await createApp();
await mkdir("docs", { recursive: true });
await writeFile(
  "docs/openapi.json",
  JSON.stringify(app.swagger(), null, 2) + "\n",
);
await app.close();
await db.destroy();
