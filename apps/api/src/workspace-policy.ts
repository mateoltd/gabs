import { refreshModulePolicies } from "@suite/server-core/governance/module-policy-refresh";
import type { FastifyInstance } from "fastify";
import { Type, Id, BootstrapSchema } from "@suite/contracts";
import {
  authorize,
  bootstrap,
  inWorkspace,
  requireCondition,
  type DB,
  type Actor,
  type authentication,
  type ServerRuntime,
} from "@suite/server-core";
import { PolicySignals } from "@suite/server-core/governance/policy-signals";

export async function registerWorkspacePolicy(
  app: FastifyInstance,
  db: DB,
  auth: ReturnType<typeof authentication>,
  runtime: ServerRuntime,
) {
  const signals = new PolicySignals(db);
  app.addHook("onClose", () => signals.close());
  app.get<{ Params: { workspaceId: string }; Querystring: { since?: string } }>(
    "/api/v1/workspaces/:workspaceId/policy",
    {
      schema: {
        operationId: "workspacePolicy",
        params: Type.Object({ workspaceId: Id }),
        querystring: Type.Object({
          since: Type.Optional(Type.String({ pattern: "^[0-9]{1,20}$" })),
        }),
        response: {
          200: Type.Object({
            revision: Type.String(),
            bootstrap: BootstrapSchema,
          }),
        },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const controller = new AbortController();
      const abort = () => controller.abort();
      reply.raw.once("close", abort);
      let subscription: ReturnType<PolicySignals["subscribe"]>;
      const read = (actor: Actor) =>
        inWorkspace(db, workspaceId, async (tx) => {
          const initial = await authorize(
            tx,
            actor,
            workspaceId,
            request.id,
            runtime,
          );
          await refreshModulePolicies(tx, initial);
          // Shared row lock makes the policy snapshot and its revision coherent.
          await tx
            .selectFrom("suite.workspace_policy")
            .select("revision")
            .where("workspace_id", "=", workspaceId)
            .forShare()
            .executeTakeFirst();
          const ctx = await authorize(
            tx,
            actor,
            workspaceId,
            request.id,
            runtime,
            undefined,
            undefined,
          );
          const revision =
            (
              await tx
                .selectFrom("suite.workspace_policy")
                .select("revision")
                .where("workspace_id", "=", workspaceId)
                .executeTakeFirst()
            )?.revision ?? "0";
          return { revision, bootstrap: await bootstrap(tx, ctx) };
        });
      try {
        await signals.connect();
        // Subscribe before reading to close the read/subscribe race.
        subscription = signals.subscribe(workspaceId, controller.signal);
        requireCondition(
          subscription,
          429,
          "POLICY_CAPACITY",
          "Policy delivery is busy. Retry shortly.",
        );
        const current = await read(request.actor);
        if (request.query.since !== current.revision) return current;
        await subscription.promise;
        const bearer = request.headers.authorization;
        const actor = bearer?.startsWith("Bearer ")
          ? await auth.bearer(bearer.slice(7))
          : await auth.session(request.cookies.suite_session);
        return await read(actor);
      } finally {
        subscription?.close();
        reply.raw.removeListener("close", abort);
      }
    },
  );
}
