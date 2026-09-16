import { useState } from "react";
import type { SuiteClient } from "@suite/api-client";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import {
  availableLocalModules,
  type LocalSession,
} from "@suite/platform/local-profiles";
import {
  Button,
  Empty,
  ErrorMessage,
  Modal,
  SchemaForm,
  Table,
  type FormSchema,
} from "@suite/ui-web";
export interface LocalRegistry {
  client: SuiteClient;
  workspaceId: string;
  online: boolean;
}
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
    [available, setAvailable] = useState<ModuleDefinition[]>(),
    [selected, setSelected] = useState<{
      module: ModuleDefinition;
      pkg: SignedArtifact;
      publicKey: string;
    }>(),
    [configuration, setConfiguration] = useState<Record<string, unknown>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [notice, setNotice] = useState("");
  const modules = availableLocalModules(session.data).filter(
    (m) =>
      Object.values(m.resources).some((r) => r.standalone) ||
      Object.values(m.operations).some((op) => op.policy === "local"),
  );
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await fn();
      changed();
    } catch (e) {
      setError(e);
    } finally {
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
            setError(undefined);
          }
        }}
        title="Local modules"
        description="Standalone modules and their data stay in this encrypted profile."
      >
        <div className="form-stack">
          <ErrorMessage error={error} />
          {notice && <p role="status">{notice}</p>}
          {selected ? (
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void action(async () => {
                  await session.install(
                    selected.pkg,
                    selected.publicKey,
                    configuration,
                  );
                  setNotice(
                    `${selected.module.name} is ready in this local profile.`,
                  );
                  setSelected(undefined);
                });
              }}
            >
              <h3>{selected.module.name}</h3>
              <p>Version {selected.module.version}</p>
              <SchemaForm
                schema={selected.module.configuration as FormSchema}
                value={configuration}
                onChange={setConfiguration}
              />
              <Button type="submit" variant="primary" disabled={busy}>
                Save local installation
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => setSelected(undefined)}
              >
                Back to modules
              </Button>
            </form>
          ) : (
            <>
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
                                    setSelected({
                                      module,
                                      pkg: release.package,
                                      publicKey: release.publicKey,
                                    });
                                    setConfiguration(
                                      release.configuration as Record<
                                        string,
                                        unknown
                                      >,
                                    );
                                  }}
                                >
                                  Configure locally
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
                          void action(async () => {
                            if (!registry?.online)
                              throw Error(
                                "Reconnect to check access before installing.",
                              );
                            const pkg = await registry.client.request({
                              operation: "moduleArtifact",
                              params: {
                                workspaceId: registry.workspaceId,
                                moduleId: module.id,
                              },
                            });
                            const trust = await registry.client.request({
                              operation: "moduleTrust",
                            });
                            setSelected({
                              module: hydrateModule(
                                pkg.artifact as unknown as ModuleDefinition,
                              ),
                              pkg,
                              publicKey: trust.publicKey,
                            });
                            setConfiguration(
                              (session.data.modules?.[module.id]?.releases[
                                pkg.version
                              ]?.configuration ?? {}) as Record<
                                string,
                                unknown
                              >,
                            );
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
