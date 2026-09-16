import { createApp } from "./app";
const { app, db } = await createApp({ logger: true });
await app.listen({
  port: Number(process.env.PORT ?? 4310),
  host: process.env.HOST ?? "127.0.0.1",
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app
      .close()
      .then(() => db.destroy())
      .then(() => process.exit(0));
  });
