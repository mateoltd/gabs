import { ApiError } from "@suite/api-client";
import type { FeatureProps } from "@suite/platform";
import type { InstallationReport } from "@suite/module-sdk/platform";
import {
  changeModuleStorage,
  readModuleStorage,
  type InstallationAttempt,
} from "@suite/platform/module-storage";

/** One bounded batch per scope; observations never authorize device changes. */
export async function flushInstallationReports(
  props: Pick<FeatureProps, "platform" | "scope" | "client">,
  priority?: string,
) {
  return navigator.locks.request(
    `suite-reports:${props.scope.userId}:${props.scope.workspaceId}`,
    async () => {
      const pending =
        (await readModuleStorage(props.platform, props.scope))
          .installationReports ?? {};
      const due = Object.entries(pending)
        .filter(
          ([, item]) =>
            !item.delivered &&
            !item.delivery?.rejected &&
            (item.delivery?.nextAttemptAt ?? 0) <= Date.now(),
        )
        .sort(
          ([a, x], [b, y]) =>
            Number(b === priority) - Number(a === priority) ||
            (x.delivery?.nextAttemptAt ?? 0) - (y.delivery?.nextAttemptAt ?? 0),
        )
        .slice(0, 4);
      await Promise.all(
        due.map(async ([id, item]) => {
          const controller = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          let delivered = false;
          let rejected: "invalid" | "superseded" | undefined;
          try {
            // The deadline also bounds transports that cannot cancel IPC in flight.
            await Promise.race([
              props.client.request(
                {
                  operation: "installationReport",
                  params: { workspaceId: props.scope.workspaceId },
                  body: { ...item.report, accountId: props.scope.userId },
                },
                { signal: controller.signal },
              ),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(Error("Report delivery timed out.")),
                  2000,
                );
              }),
            ]);
            delivered = true;
          } catch (error) {
            if (error instanceof ApiError) {
              if ([400, 404].includes(error.status)) rejected = "invalid";
              if (error.status === 409) rejected = "superseded";
            }
          } finally {
            clearTimeout(timer);
            controller.abort();
          }
          await changeModuleStorage(props.platform, props.scope, (s) => {
            const current = s.installationReports?.[id];
            if (
              current?.report.attemptId !== item.report.attemptId ||
              current.report.sequence !== item.report.sequence
            )
              return;
            const attempts = Math.min((item.delivery?.attempts ?? 0) + 1, 20);
            current.delivered = delivered;
            current.delivery = {
              attempts,
              nextAttemptAt:
                delivered || rejected
                  ? 0
                  : Date.now() + Math.min(1000 * 2 ** (attempts - 1), 300000),
              ...(rejected ? { rejected } : {}),
            };
          });
        }),
      );
    },
  );
}

export async function reportInstallation(
  props: Pick<FeatureProps, "platform" | "scope" | "client">,
  id: string,
  attempt: InstallationAttempt,
  phase: InstallationReport["phase"],
  errorCode?: InstallationReport["errorCode"],
  receiptId?: string,
) {
  try {
    await changeModuleStorage(props.platform, props.scope, (s) => {
      const previous = s.installationReports?.[id];
      const version =
        attempt.releases.find((r) => r.moduleId === id)?.version ??
        attempt.reportVersion;
      (s.installationReports ??= {})[id] = {
        delivered: false,
        // An endpoint outage remains backed off when the local phase advances.
        ...(previous?.delivery &&
        !previous.delivered &&
        !previous.delivery.rejected
          ? { delivery: previous.delivery }
          : {}),
        report: {
          moduleId: id,
          accountId: props.scope.userId,
          action: attempt.action,
          deviceId: attempt.deviceId,
          attemptId: attempt.requestId,
          sequence:
            previous?.report.attemptId === attempt.requestId
              ? previous.report.sequence + 1
              : 1,
          ...(version ? { version } : {}),
          phase,
          ...(errorCode ? { errorCode } : {}),
          ...(receiptId ? { receiptId } : {}),
        },
      };
    });
    await flushInstallationReports(props, id);
  } catch {
    // Observability failure must not change the authoritative operation outcome.
  }
}
