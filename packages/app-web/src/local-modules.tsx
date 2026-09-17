import {
  LocalModuleHistory,
  LocalModuleVersions,
} from "./local-module-history";
import { LocalReferenceAccess } from "./local-reference-access";
import { useEffect, useRef, useState } from "react";
import {
  hydrateModule,
  localStorageContract,
  type ModuleDefinition,
} from "@suite/module-sdk";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import {
  availableLocalModules,
  localReferenceAccess,
  type LocalReferenceSelection,
  planLocalInstallation,
  planRetainedLocalInstallation,
  type LocalSession,
  type LocalRelease,
} from "@suite/platform/local-profiles";
import {
  Button,
  Checkbox,
  Empty,
  ErrorMessage,
  Modal,
  SchemaForm,
  Table,
  type FormSchema,
} from "@suite/ui-web";
import {
  resumeLocalDownload,
  type LocalRegistry,
} from "./local-module-download";
export type { LocalRegistry } from "./local-module-download";
export function LocalModules({
  session,
  registry,
  changed,
  onlineWorkspaces,
}: {
  session: LocalSession;
  registry?: LocalRegistry;
  changed: () => void;
  onlineWorkspaces: () => void;
}) {
  const [open, setOpen] = useState(false),
    [versions, setVersions] = useState<string>(),
    [history, setHistory] = useState(false),
    [references, setReferences] = useState(false),
    [available, setAvailable] = useState<ModuleDefinition[]>(),
    [selected, setSelected] = useState<{
      downloadId?: string;
      module: ModuleDefinition;
      pkg: SignedArtifact;
      publicKey: string;
      related?: {
        module: ModuleDefinition;
        pkg: SignedArtifact;
        publicKey: string;
        configuration: Record<string, unknown>;
      }[];
    }>(),
    [installGrants, setInstallGrants] = useState<LocalReferenceSelection[]>([]),
    [configuration, setConfiguration] = useState<Record<string, unknown>>({}),
    [busy, setBusy] = useState(false),
    [downloading, setDownloading] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState("");
  const controller = useRef<AbortController>(undefined);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error || downloading)
      panel.current
        ?.closest<HTMLElement>('[role="dialog"]')
        ?.scrollTo({ top: 0 });
  }, [error, downloading]);
  useEffect(() => {
    panel.current
      ?.closest<HTMLElement>('[role="dialog"]')
      ?.scrollTo({ top: 0 });
  }, [selected?.pkg.digest, versions, history, references]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => setInstallGrants([]), [selected?.pkg.digest]);
  const selectedModules = selected
    ? [selected.module, ...(selected.related ?? []).map((r) => r.module)]
    : [];
  const referenceChoices = localReferenceAccess(
    session.data,
    selectedModules,
  ).filter(
    ({ consumer, provider, granted }) =>
      !granted &&
      selectedModules.some((m) => m.id === consumer.id || m.id === provider.id),
  );
  const retained = Object.entries(session.data.modules ?? {}).filter(
    ([, installation]) => !installation.active,
  );
  const unfinished = Object.entries(
    session.data.installationAttempts ?? {},
  ).flatMap(([id, attempt]) =>
    attempt.state === "accepted" ? [] : [{ id, ...attempt }],
  );
  const downloads = Object.entries(session.data.downloads ?? {});
  const continueDownload = async (id: string, signal: AbortSignal) => {
    setDownloading(true);
    try {
      await resumeLocalDownload(session, id, registry, signal, changed);
      const download = session.data.downloads![id];
      const prepared = download.modules.map((item) => ({
        module: hydrateModule(
          item.release!.package.artifact as unknown as ModuleDefinition,
        ),
        pkg: item.release!.package,
        publicKey: item.release!.publicKey,
        configuration: item.release!.configuration as Record<string, unknown>,
      }));
      const root = prepared.find((m) => m.module.id === download.rootModuleId)!;
      setSelected({
        ...root,
        downloadId: id,
        related: prepared.filter((m) => m !== root),
      });
      setConfiguration(root.configuration);
    } finally {
      setDownloading(false);
    }
  };
  const modules = availableLocalModules(session.data).filter(
    (m) =>
      Object.values(m.resources).some((r) => r.standalone) ||
      Object.values(m.operations).some((op) => op.policy === "local"),
  );
  const selectRetained = (module: ModuleDefinition, release: LocalRelease) => {
    const related = planRetainedLocalInstallation(
      session.data,
      module.id,
      release.package.version,
    )
      .filter((r) => r.package.module_id !== module.id)
      .map((r) => ({
        module: hydrateModule(
          r.package.artifact as unknown as ModuleDefinition,
        ),
        pkg: r.package,
        publicKey: r.publicKey,
        configuration: r.configuration as Record<string, unknown>,
      }));
    setSelected({
      module,
      pkg: release.package,
      publicKey: release.publicKey,
      related,
    });
    setConfiguration(release.configuration as Record<string, unknown>);
  };
  const action = async (fn: (signal: AbortSignal) => Promise<void>) => {
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await fn(current.signal);
      changed();
    } catch (e) {
      setError(e);
    } finally {
      controller.current = undefined;
      setBusy(false);
    }
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Manage local modules</Button>
      <Modal
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            setSelected(undefined);
            setVersions(undefined);
            setHistory(false);
            setReferences(false);
            setError(undefined);
          }
        }}
        title="Local modules"
        description="Standalone modules and their data stay in this encrypted profile."
      >
        <div className="form-stack" ref={panel}>
          <ErrorMessage error={error} />
          {notice && <p role="status">{notice}</p>}
          {selected ? (
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void action(async (signal) => {
                  const releases = [
                    {
                      package: selected.pkg,
                      publicKey: selected.publicKey,
                      configuration,
                    },
                    ...(selected.related ?? []).map((item) => ({
                      package: item.pkg,
                      publicKey: item.publicKey,
                      configuration: item.configuration,
                    })),
                  ];
                  if (selected.downloadId) {
                    try {
                      await session.installDownload(
                        selected.downloadId,
                        Object.fromEntries(
                          releases.map((r) => [
                            r.package.module_id,
                            r.configuration,
                          ]),
                        ),
                        { signal, referenceGrants: installGrants },
                      );
                    } finally {
                      if (!session.data.downloads?.[selected.downloadId])
                        setSelected(
                          (current) =>
                            current && { ...current, downloadId: undefined },
                        );
                    }
                  } else {
                    await session.installSet(selected.module.id, releases, {
                      signal,
                      referenceGrants: installGrants,
                    });
                  }
                  setNotice(
                    `${selected.module.name} is ready in this local profile.`,
                  );
                  setSelected(undefined);
                });
              }}
            >
              <h3>{selected.module.name}</h3>
              <p>Version {selected.module.version}</p>
              {(session.data.modules?.[selected.module.id]?.schemaVersion ??
                1) < localStorageContract(selected.module).version &&
                Object.keys(session.data.records).some((key) =>
                  key.startsWith(selected.module.id + "/"),
                ) && (
                  <p>
                    This update changes how saved records are stored. If the
                    update cannot finish, your current version and records
                    remain available.
                  </p>
                )}
              <SchemaForm
                schema={selected.module.configuration as FormSchema}
                value={configuration}
                onChange={setConfiguration}
              />
              {!!selected.related?.length && (
                <>
                  <p>
                    These releases are required together. Review each
                    configuration. All selected modules and their saved data
                    update together, or your current installation is preserved.
                  </p>
                  {selected.related.map((item) => (
                    <fieldset
                      key={item.module.id}
                      className="form-stack"
                      disabled={busy}
                    >
                      <legend>{item.module.name}</legend>
                      <p>Version {item.module.version}</p>
                      <SchemaForm
                        schema={item.module.configuration as FormSchema}
                        value={item.configuration}
                        onChange={(value) =>
                          setSelected(
                            (current) =>
                              current && {
                                ...current,
                                related: current.related?.map((r) =>
                                  r.module.id === item.module.id
                                    ? { ...r, configuration: value }
                                    : r,
                                ),
                              },
                          )
                        }
                      />
                    </fieldset>
                  ))}
                </>
              )}
              {referenceChoices.length > 0 && (
                <fieldset className="form-stack" disabled={busy}>
                  <legend>Reference access for these releases</legend>
                  <p>
                    Choose which records these modules may read during
                    installation and afterward. Access takes effect only if the
                    whole installation succeeds. Migrations that need a new
                    reference will fail without access; your current records
                    remain available.
                  </p>
                  {referenceChoices.map(({ consumer, provider, resource }) => {
                    const decision = {
                      consumerId: consumer.id,
                      consumerVersion: consumer.version,
                      providerId: provider.id,
                      providerVersion: provider.version,
                      resource,
                    };
                    const matches = (item: LocalReferenceSelection) =>
                      item.consumerId === consumer.id &&
                      item.providerId === provider.id &&
                      item.resource === resource;
                    return (
                      <div key={`${consumer.id}/${provider.id}/${resource}`}>
                        <label className="local-reference-choice">
                          <Checkbox
                            checked={installGrants.some(matches)}
                            onCheckedChange={(allowed) =>
                              setInstallGrants((current) => [
                                ...current.filter((item) => !matches(item)),
                                ...(allowed ? [decision] : []),
                              ])
                            }
                          />
                          <span>
                            Allow {consumer.name} to read {provider.name}:{" "}
                            {provider.resources[resource].title}
                          </span>
                        </label>
                        <p className="small muted">
                          {consumer.name} {consumer.version} reads{" "}
                          {provider.name} {provider.version}.
                        </p>
                      </div>
                    );
                  })}
                </fieldset>
              )}
              <Button type="submit" variant="primary" disabled={busy}>
                Save local installation
              </Button>
              {busy && (
                <Button
                  type="button"
                  onClick={() => controller.current?.abort()}
                >
                  Cancel installation
                </Button>
              )}
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSelected(undefined);
                  setVersions(undefined);
                }}
              >
                Back to modules
              </Button>
            </form>
          ) : versions ? (
            <LocalModuleVersions
              data={session.data}
              moduleId={versions}
              select={(module, release) => {
                try {
                  selectRetained(module, release);
                  setError(undefined);
                } catch (error) {
                  setError(error);
                }
              }}
              back={() => setVersions(undefined)}
            />
          ) : references ? (
            <LocalReferenceAccess
              session={session}
              changed={changed}
              back={() => setReferences(false)}
            />
          ) : history ? (
            <LocalModuleHistory
              data={session.data}
              back={() => setHistory(false)}
            />
          ) : (
            <>
              <div className="module-toolbar">
                <Button disabled={busy} onClick={() => setReferences(true)}>
                  Reference access
                </Button>
              </div>
              {downloads.length > 0 && (
                <>
                  <h3>Saved downloads</h3>
                  <p className="small">
                    Verified releases stay in this encrypted profile. Finish
                    downloading, then review configuration before installation.
                  </p>
                  <ul
                    className="local-installations"
                    aria-label="Saved local downloads"
                  >
                    {downloads.map(([id, download]) => {
                      const root = download.modules.find(
                        (m) => m.moduleId === download.rootModuleId,
                      )!;
                      const saved = download.modules.filter(
                        (m) => m.release,
                      ).length;
                      return (
                        <li key={id}>
                          <h4>{root.title}</h4>
                          <p className="small">Version {root.moduleVersion}</p>
                          <p role="status">
                            {saved} of {download.modules.length} releases saved
                          </p>
                          <div className="module-toolbar">
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void action((signal) =>
                                  continueDownload(id, signal),
                                )
                              }
                            >
                              {saved === download.modules.length
                                ? "Review installation"
                                : "Resume download"}
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void action(async () => {
                                  await session.dismissDownload(id);
                                  setNotice(
                                    "Download discarded. Installed modules and records are preserved.",
                                  );
                                })
                              }
                            >
                              Discard download
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {downloading && (
                    <Button onClick={() => controller.current?.abort()}>
                      Cancel download
                    </Button>
                  )}
                </>
              )}
              {unfinished.length > 0 && (
                <>
                  <h3>Unfinished installations</h3>
                  <p className="small">
                    Downloaded releases and configuration are saved in this
                    profile. Resume offline, or discard the request to choose
                    another release. Your installed modules and records are
                    preserved.
                  </p>
                  <ul
                    className="local-installations"
                    aria-label="Unfinished local installations"
                  >
                    {unfinished.map(({ id, ...attempt }) => (
                      <li key={id}>
                        <h4>{attempt.title}</h4>
                        <p className="small">Version {attempt.moduleVersion}</p>
                        {(attempt.modules?.length ?? 0) > 1 && (
                          <ul>
                            {attempt
                              .modules!.filter(
                                (m) => m.moduleId !== attempt.moduleId,
                              )
                              .map((m) => (
                                <li key={m.moduleId}>
                                  {m.title} {m.moduleVersion}
                                </li>
                              ))}
                          </ul>
                        )}
                        <p>
                          {attempt.state === "pending"
                            ? "Awaiting recovery"
                            : attempt.state === "interrupted"
                              ? "Interrupted"
                              : "Failed"}
                        </p>
                        {!!attempt.referenceGrants?.length && (
                          <div>
                            <p>
                              Reference access approved for this installation:
                            </p>
                            <ul>
                              {attempt.referenceGrants.map((grant) => {
                                const releases = [
                                  attempt.release,
                                  ...(attempt.related ?? []),
                                ];
                                const definition = (
                                  id: string,
                                  version: string,
                                ) => {
                                  const release =
                                    releases.find(
                                      (r) =>
                                        r.package.module_id === id &&
                                        r.package.version === version,
                                    ) ??
                                    session.data.modules?.[id]?.releases[
                                      version
                                    ];
                                  return release
                                    ? hydrateModule(
                                        release.package
                                          .artifact as unknown as ModuleDefinition,
                                      )
                                    : modules.find(
                                        (m) =>
                                          m.id === id && m.version === version,
                                      );
                                };
                                const consumer = definition(
                                  grant.consumerId,
                                  grant.consumerVersion,
                                );
                                const provider = definition(
                                  grant.providerId,
                                  grant.providerVersion,
                                );
                                return (
                                  <li
                                    key={`${grant.consumerId}/${grant.providerId}/${grant.resource}`}
                                  >
                                    {consumer?.name ?? grant.consumerId}{" "}
                                    {grant.consumerVersion} may read{" "}
                                    {provider?.name ?? grant.providerId}{" "}
                                    {grant.providerVersion}:{" "}
                                    {provider?.resources[grant.resource]
                                      ?.title ?? grant.resource}
                                    .
                                  </li>
                                );
                              })}
                            </ul>
                            <p>
                              Discard this installation to cancel its pending
                              access approvals.
                            </p>
                          </div>
                        )}
                        {attempt.error && (
                          <p className="small">{attempt.error}</p>
                        )}
                        <div className="module-toolbar">
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void action(async (signal) => {
                                await session.retryInstallation(id, {
                                  signal,
                                });
                                setNotice(
                                  `${attempt.title} is ready in this local profile.`,
                                );
                              })
                            }
                          >
                            Resume installation
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                await session.dismissInstallation(id);
                                setNotice(
                                  "Installation request discarded. Your installed module and records are preserved.",
                                );
                              })
                            }
                          >
                            Discard installation
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {busy && (
                    <Button onClick={() => controller.current?.abort()}>
                      Cancel installation
                    </Button>
                  )}
                </>
              )}
              <div className="table-scroll">
                <Table aria-label="Local modules">
                  <thead>
                    <tr>
                      <th>Module</th>
                      <th>Version</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((module) => {
                      const installation = session.data.modules?.[module.id],
                        release = installation?.releases[installation.version];
                      return (
                        <tr key={module.id}>
                          <td>{module.name}</td>
                          <td>{module.version}</td>
                          <td>
                            {release ? (
                              <div className="module-toolbar">
                                <Button
                                  disabled={busy}
                                  onClick={() => {
                                    try {
                                      selectRetained(module, release);
                                    } catch (error) {
                                      setError(error);
                                    }
                                  }}
                                >
                                  Configure locally
                                </Button>
                                <Button
                                  disabled={busy}
                                  onClick={() => {
                                    setVersions(module.id);
                                    setNotice("");
                                    setError(undefined);
                                  }}
                                >
                                  Retained versions
                                </Button>
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    void action(async () => {
                                      await session.uninstall(module.id);
                                      setNotice(
                                        `${module.name} was removed. Its records and recovery requests are preserved.`,
                                      );
                                    })
                                  }
                                >
                                  Uninstall locally
                                </Button>
                              </div>
                            ) : (
                              <span>Included with Common</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
              {retained.length > 0 && (
                <>
                  <h3>Retained modules</h3>
                  <p className="small">
                    Restore a removed module from this profile without
                    connecting. Its saved records and requests are retained.
                  </p>
                  <div className="table-scroll">
                    <Table aria-label="Retained local modules">
                      <thead>
                        <tr>
                          <th>Module</th>
                          <th>Version</th>
                          <th>Recovery</th>
                        </tr>
                      </thead>
                      <tbody>
                        {retained.map(([id, installation]) => {
                          const release =
                            installation.releases[installation.version];
                          const module = hydrateModule(
                            release.package
                              .artifact as unknown as ModuleDefinition,
                          );
                          return (
                            <tr key={id}>
                              <td>{module.name}</td>
                              <td>{module.version}</td>
                              <td>
                                <Button
                                  disabled={busy}
                                  onClick={() => {
                                    try {
                                      selectRetained(module, release);
                                    } catch (error) {
                                      setError(error);
                                    }
                                  }}
                                >
                                  Restore locally
                                </Button>
                                <Button
                                  disabled={busy}
                                  onClick={() => {
                                    setVersions(id);
                                    setNotice("");
                                    setError(undefined);
                                  }}
                                >
                                  Retained versions
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </Table>
                  </div>
                </>
              )}
              <Button
                disabled={busy}
                onClick={() => {
                  setHistory(true);
                  setNotice("");
                  setError(undefined);
                }}
              >
                Installation history
              </Button>
              {registry?.online ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const [state, bootstrap] = await Promise.all([
                        registry.client.request({
                          operation: "platformState",
                          params: { workspaceId: registry.workspaceId },
                        }),
                        registry.client.request({
                          operation: "bootstrap",
                          params: { workspaceId: registry.workspaceId },
                        }),
                      ]);
                      const entitled = new Set(
                        bootstrap.modules
                          .filter(
                            (m) =>
                              m.entitled && m.assigned && m.state === "enabled",
                          )
                          .map((m) => m.moduleId),
                      );
                      setAvailable(
                        state.modules.filter(
                          (m) =>
                            entitled.has(m.id) &&
                            (Object.values(m.resources).some(
                              (r) => r.standalone,
                            ) ||
                              Object.values(m.operations).some(
                                (op) => op.policy === "local",
                              )),
                        ),
                      );
                    })
                  }
                >
                  Browse personal modules
                </Button>
              ) : (
                <p className="small">
                  Sign in and connect to install modules from your personal
                  workspace. Installed local modules remain available offline.
                </p>
              )}
              {!registry && (
                <Button onClick={onlineWorkspaces}>Online workspaces</Button>
              )}
              {available && (
                <>
                  <h3>Personal modules</h3>
                  <p className="small">
                    Only module code is installed. Company data and
                    configuration are not copied.
                  </p>
                  {!available.length && (
                    <Empty
                      title="No standalone modules available"
                      description="Modules supporting local work appear here after activation in your personal workspace."
                    />
                  )}
                  {available.map((module) => (
                    <div key={module.id} className="module-toolbar">
                      <span>
                        {module.name} {module.version}
                      </span>
                      <Button
                        disabled={busy || !registry?.online}
                        onClick={() =>
                          void action(async (signal) => {
                            if (!registry?.online)
                              throw Error(
                                "Reconnect to check access before installing.",
                              );
                            const plan = planLocalInstallation(
                              session.data,
                              module,
                              available,
                            );
                            const id = await session.beginDownload(
                              module.id,
                              {
                                userId: registry.userId,
                                workspaceId: registry.workspaceId,
                              },
                              plan,
                            );
                            await continueDownload(id, signal);
                          })
                        }
                      >
                        Install {module.name}
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
