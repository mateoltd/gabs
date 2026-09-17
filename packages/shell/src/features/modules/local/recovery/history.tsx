import { useState } from "react";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import {
  localLifecycleHistory,
  localSchemaVersion,
  planRetainedLocalInstallation,
  type LocalData,
  type LocalRelease,
} from "@suite/client/local-profiles";
import { Button, Empty } from "@suite/ui-web";
import { useShellComposition } from "../../../../app/composition";

export function LocalModuleVersions({
  data,
  moduleId,
  select,
  back,
}: {
  data: LocalData;
  moduleId: string;
  select: (module: ModuleDefinition, release: LocalRelease) => void;
  back: () => void;
}) {
  const { catalog } = useShellComposition();
  const installation = data.modules?.[moduleId];
  if (!installation) return <Button onClick={back}>Back to modules</Button>;
  const current = hydrateModule(
    installation.releases[installation.version].package
      .artifact as unknown as ModuleDefinition,
  );
  return (
    <div className="form-stack">
      <h3>{current.name}</h3>
      <p>
        {installation.active ? "Current version" : "Last installed version"}{" "}
        {installation.version}. Saved data version{" "}
        {localSchemaVersion(data, current, catalog)}.
      </p>
      <p className="small">
        Choose a retained release to review its configuration and any required
        companion changes. Changing releases preserves your saved data.
      </p>
      <ul className="local-installations" aria-label="Retained versions">
        {Object.entries(installation.releases)
          .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
          .map(([version, release]) => {
            let issue = "",
              related = 0;
            try {
              related =
                planRetainedLocalInstallation(data, moduleId, version, catalog)
                  .length - 1;
            } catch (error) {
              issue = (error as Error).message;
            }
            return (
              <li key={version}>
                <h4>Version {version}</h4>
                {installation.active && version === installation.version && (
                  <p className="small">Active</p>
                )}
                <p>
                  {issue ||
                    (related
                      ? `${related} related release changes require review`
                      : "Available for review")}
                </p>
                <Button
                  disabled={!!issue}
                  onClick={() =>
                    select(
                      hydrateModule(
                        release.package.artifact as unknown as ModuleDefinition,
                      ),
                      release,
                    )
                  }
                >
                  Review version {version}
                </Button>
              </li>
            );
          })}
      </ul>
      <Button onClick={back}>Back to modules</Button>
    </div>
  );
}

export function LocalModuleHistory({
  data,
  back,
}: {
  data: LocalData;
  back: () => void;
}) {
  const history = localLifecycleHistory(data);
  const [page, setPage] = useState(0);
  const size = 20,
    start = page * size;
  return (
    <div className="form-stack">
      <h3>Installation history</h3>
      <p className="small">
        Saved on this device for this profile. Older entries show their known
        request time.
      </p>
      {!history.length ? (
        <Empty
          title="No installation history yet"
          description="Successful installations and removals appear here."
        />
      ) : (
        <>
          <ul
            className="local-installations"
            aria-label="Local installation history"
          >
            {history.slice(start, start + size).map((event) => (
              <li key={event.id}>
                <h4>
                  {event.action === "installed"
                    ? "Saved installation"
                    : "Removed locally"}
                </h4>
                <p className="small">
                  {event.time === "requested" ? "Requested " : ""}
                  <time dateTime={new Date(event.at).toISOString()}>
                    {new Date(event.at).toLocaleString()}
                  </time>
                </p>
                <ul aria-label="Modules in this change">
                  {event.modules.map((m) => (
                    <li key={m.moduleId}>
                      {m.title} {m.moduleVersion}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="module-toolbar">
            <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous history
            </Button>
            <p role="status">
              {start + 1} to {Math.min(start + size, history.length)} of{" "}
              {history.length}
            </p>
            <Button
              disabled={start + size >= history.length}
              onClick={() => setPage(page + 1)}
            >
              Next history
            </Button>
          </div>
        </>
      )}
      <Button onClick={back}>Back to modules</Button>
    </div>
  );
}
