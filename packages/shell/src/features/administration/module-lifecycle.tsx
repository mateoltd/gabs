import { type FeatureProps } from "@suite/client";
import { readModuleStorage } from "@suite/client/module-storage";
import { storageContract } from "@suite/module-sdk";
import type { ReleaseManifest } from "@suite/module-sdk/registry";
import { compareVersions } from "@suite/module-sdk/registry";
import {
  Badge,
  Button,
  Checkbox,
  Empty,
  ErrorMessage,
  Field,
  Input,
  Loading,
  Modal,
  SchemaForm,
  Select,
  SelectOption,
  type FormSchema,
} from "@suite/ui-web";
import { navigationIcons } from "@suite/ui-web/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  deviceId,
  installModule,
  uninstallModule,
} from "../modules/installation";
import { BusinessCutover } from "./business-cutover";
import { ModuleFleetDialog } from "./module-fleet";
const archetypes = [
  "modern-dark",
  "chromatic-playful",
  "executive-serious",
  "classic-retro",
  "neumorphic-soft",
  "minimal-clean",
  "industrial-technical",
  "glassmorphic-luxe",
  "editorial-paper",
  "material-expressive",
];
export function usePlatformState(props: FeatureProps) {
  return useQuery({
    queryKey: [props.scope.userId, props.scope.workspaceId, "platform"],
    queryFn: () =>
      props.client.request({
        operation: "platformState",
        params: { workspaceId: props.scope.workspaceId },
      }),
    enabled: props.online,
    refetchInterval: 30000,
  });
}
export function ModuleLifecycle(
  props: FeatureProps & { renderAccess?: (moduleId: string) => ReactNode },
) {
  const state = usePlatformState(props),
    qc = useQueryClient();
  const [fleetModule, setFleetModule] = useState("");
  const [error, setError] = useState<unknown>(),
    [errorModule, setErrorModule] = useState(""),
    [busy, setBusy] = useState(""),
    [selected, setSelected] = useState(""),
    [config, setConfig] = useState<Record<string, unknown>>({}),
    [configValid, setConfigValid] = useState(true),
    [pin, setPin] = useState(""),
    [mandatory, setMandatory] = useState(true),
    [acceptedVersions, setAcceptedVersions] = useState<string[]>([]),
    [migrationVersion, setMigrationVersion] = useState("");
  const local = useQuery({
    queryKey: [
      props.scope.userId,
      props.scope.workspaceId,
      "lifecycle-storage",
    ],
    queryFn: () => readModuleStorage(props.platform, props.scope),
    networkMode: "always",
    refetchInterval: 2000,
  });
  const admin = props.bootstrap.permissions.includes("modules.manage");
  const command = async (
    action: string,
    value: Record<string, unknown>,
    version = 0,
  ) =>
    props.client.request({
      operation: "platformCommand",
      params: { workspaceId: props.scope.workspaceId },
      body: { action, value, version },
      idempotencyKey: crypto.randomUUID(),
    });
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(undefined);
    setErrorModule(id);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      await qc.invalidateQueries({
        queryKey: [props.scope.userId, props.scope.workspaceId],
      });
      setBusy("");
    }
  };
  const install = (id: string, repair: boolean) =>
    installModule(props, state.data!, id, repair);
  if (state.isPending) return <Loading />;
  const selectedModule = state.data?.modules.find((m) => m.id === selected);
  const migrationReleases = (state.data?.releases ?? [])
    .filter((r) => r.module_id === selected)
    .sort((a, b) => compareVersions(b.version, a.version));
  const storedSchema =
    state.data?.storage?.find((s) => s.module_id === selected)
      ?.schema_version ?? 1;
  const targetStorage = storageContract(
    (migrationReleases.find((r) => r.version === migrationVersion)?.manifest ??
      {}) as unknown as ReleaseManifest,
  );
  const store = state.data?.settings.find((s) => s.key === "store-policy");
  if (!admin && store?.value.mode === "blocked")
    return (
      <Empty
        title="Store access is blocked"
        description="Ask your administrator for module assignments."
      />
    );
  return (
    <section aria-label="Module installation">
      <div className="module-policy-toolbar">
        {admin && (
          <Field label="Corporate store policy">
            <Select
              value={String(store?.value.mode ?? "free")}
              disabled={!!busy}
              onValueChange={(mode) =>
                void act("store", () =>
                  command("store-policy", { mode }, store?.version ?? 0),
                )
              }
            >
              <SelectOption value="free">
                Free access, subject to module policy
              </SelectOption>
              <SelectOption value="approval">Approval required</SelectOption>
              <SelectOption value="blocked">Blocked</SelectOption>
            </Select>
          </Field>
        )}
        {admin && state.data && (
          <BusinessCutover
            key={props.scope.workspaceId}
            {...props}
            state={state.data}
          />
        )}
      </div>
      <ErrorMessage
        error={
          state.data?.modules.some((m) => m.id === errorModule)
            ? state.error
            : (error ?? state.error)
        }
      />
      <div className="module-grid">
        {state.data?.modules.map((module) => {
          const installation = state.data.installations.find(
            (i) =>
              i.module_id === module.id &&
              i.device_id === deviceId() &&
              i.state === "installed",
          );
          const attempt = local.data?.lifecycle?.[module.id];
          const lifecycleError = local.data?.lifecycleErrors?.[module.id];
          const entitlement = props.bootstrap.modules.find(
            (m) => m.moduleId === module.id,
          );
          const published = state.data.releases.some(
            (r) => r.module_id === module.id && r.version === module.version,
          );
          const Icon =
            navigationIcons[module.id as keyof typeof navigationIcons] ??
            navigationIcons.modules;
          return (
            <section key={module.id} className="panel module-install-card">
              <h3>
                <span className="module-card-icon">
                  <Icon size={20} weight="fill" aria-hidden="true" />
                </span>
                {module.name}
              </h3>
              <p className="module-card-description">{module.description}</p>
              <div className="module-release-meta">
                <span>Version {module.version}</span>
                <Badge>
                  {installation
                    ? local.data?.installed[module.id]?.version ===
                      installation.version
                      ? `Installed ${installation.version}`
                      : "Device setup incomplete"
                    : "Not installed on this device"}
                </Badge>
              </div>
              <p className="small">
                {published
                  ? "Signed release available"
                  : "A signed release has not been published"}
              </p>
              {attempt && (
                <p role="status">
                  {attempt.action === "uninstall"
                    ? "Removal awaiting confirmation"
                    : attempt.phase === "confirming"
                      ? "Installation awaiting confirmation"
                      : "Installation pending"}
                  . Verified downloads and pending work are preserved.
                </p>
              )}
              {selected !== module.id && (
                <ErrorMessage
                  error={
                    errorModule === module.id && error
                      ? error
                      : lifecycleError
                        ? new Error(lifecycleError)
                        : undefined
                  }
                />
              )}
              <div className="module-toolbar">
                <Button
                  disabled={
                    !!busy ||
                    !props.online ||
                    attempt?.action === "uninstall" ||
                    !published ||
                    !entitlement?.assigned ||
                    !entitlement.entitled ||
                    entitlement.state !== "enabled"
                  }
                  onClick={() =>
                    void act(module.id, () =>
                      install(module.id, !!installation && !attempt),
                    )
                  }
                >
                  {attempt?.action === "install"
                    ? "Resume installation"
                    : installation
                      ? installation.version === module.version
                        ? "Verify and repair"
                        : "Update"
                      : "Install"}
                </Button>
                {(installation || attempt?.action === "uninstall") && (
                  <Button
                    disabled={!!busy || !props.online}
                    onClick={() =>
                      void act(module.id, () =>
                        uninstallModule(
                          props,
                          module.id,
                          attempt?.action === "uninstall"
                            ? attempt.requestId
                            : undefined,
                        ),
                      )
                    }
                  >
                    {attempt?.action === "uninstall"
                      ? "Resume removal"
                      : "Uninstall"}
                  </Button>
                )}
                {admin && (
                  <Button
                    onClick={() => {
                      setSelected(module.id);
                      setError(undefined);
                      setMigrationVersion(
                        state.data.releases
                          .filter((r) => r.module_id === module.id)
                          .sort((a, b) =>
                            compareVersions(b.version, a.version),
                          )[0]?.version ?? "",
                      );
                      setConfig(
                        state.data.config.find((c) => c.moduleId === module.id)
                          ?.config ?? {},
                      );
                      setPin(
                        String(
                          state.data.settings.find(
                            (s) => s.key === `pin:${module.id}`,
                          )?.value.version ?? "",
                        ),
                      );
                      const rollout = state.data.settings.find(
                        (s) => s.key === `pin:${module.id}`,
                      )?.value;
                      setMandatory(rollout?.mandatory !== false);
                      setAcceptedVersions(
                        Array.isArray(rollout?.acceptedVersions)
                          ? rollout.acceptedVersions.filter(
                              (v): v is string => typeof v === "string",
                            )
                          : [],
                      );
                    }}
                  >
                    Configure
                  </Button>
                )}
                {admin && (
                  <Button onClick={() => setFleetModule(module.id)}>
                    View devices
                  </Button>
                )}
                {props.bootstrap.permissions.includes("roles.manage") && (
                  <Link to={`/organization?module=${module.id}`}>
                    Permissions
                  </Link>
                )}
              </div>
              <div className="module-card-footer">
                {props.renderAccess?.(module.id)}
              </div>
            </section>
          );
        })}
      </div>
      <Modal
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) setSelected("");
        }}
        title={`Configure ${selectedModule?.name ?? selected}`}
        description="Configure required parameters, review grants, and publish to employees."
      >
        {selectedModule && (
          <div className="form-stack">
            <SchemaForm
              schema={selectedModule.configuration as FormSchema}
              value={config}
              onChange={setConfig}
              onValidityChange={setConfigValid}
            />
            <ErrorMessage
              error={errorModule === selected ? error : undefined}
            />
            <Button
              disabled={!!busy || !configValid}
              onClick={() =>
                void act(selected, async () => {
                  const activation = props.bootstrap.modules.find(
                    (m) => m.moduleId === selected,
                  );
                  await props.client.request({
                    operation: "moduleEdit",
                    params: {
                      workspaceId: props.scope.workspaceId,
                      moduleId: selected,
                    },
                    body: {
                      state: "enabled",
                      accessPolicy: activation?.accessPolicy ?? "admin",
                      config,
                    },
                  });
                  setSelected("");
                })
              }
            >
              Validate and publish
            </Button>
            {Object.keys(selectedModule.dependencies).map((dep) => {
              const grant = state.data?.settings.find(
                (s) => s.key === `grant:${selected}:${dep}`,
              );
              const services = Array.isArray(grant?.value.services)
                ? (grant.value.services as string[])
                : [];
              const publicOperations = Object.entries(
                state.data?.modules.find((m) => m.id === dep)?.operations ?? {},
              ).filter(([, op]) => op.public);
              return (
                <div key={dep} className="space-y-3">
                  <Field label={`Reference records in ${dep}`}>
                    <Checkbox
                      checked={grant?.value.read === true}
                      disabled={!!busy}
                      onCheckedChange={(read) =>
                        void act(selected, () =>
                          command(
                            "grant",
                            { source: selected, target: dep, read, services },
                            grant?.version ?? 0,
                          ),
                        )
                      }
                    />
                  </Field>
                  {publicOperations.map(([name, op]) => (
                    <Field key={name} label={`Allow ${dep}: ${op.title}`}>
                      <Checkbox
                        checked={services.includes(name)}
                        disabled={!!busy}
                        onCheckedChange={(allowed) =>
                          void act(selected, () =>
                            command(
                              "grant",
                              {
                                source: selected,
                                target: dep,
                                read: grant?.value.read === true,
                                services: allowed
                                  ? [...services, name]
                                  : services.filter((s) => s !== name),
                              },
                              grant?.version ?? 0,
                            ),
                          )
                        }
                      />
                    </Field>
                  ))}
                </div>
              );
            })}
            {migrationReleases.some(
              (r) =>
                storageContract(r.manifest as unknown as ReleaseManifest)
                  .version > 1,
            ) && (
              <section
                className="form-stack"
                aria-label="Module storage migration"
              >
                <h3>Stored data schema</h3>
                <p>
                  Current schema: {storedSchema}. Migrations move forward and
                  preserve existing data if they fail. Older releases must
                  declare compatibility with the resulting schema.
                </p>
                <Field label="Migration target release">
                  <Select
                    value={migrationVersion}
                    onValueChange={(v) => setMigrationVersion(v ?? "")}
                  >
                    {migrationReleases.map((release) => (
                      <SelectOption
                        key={release.version}
                        value={release.version}
                      >
                        {release.version} (schema{" "}
                        {
                          storageContract(
                            release.manifest as unknown as ReleaseManifest,
                          ).version
                        }
                        )
                      </SelectOption>
                    ))}
                  </Select>
                </Field>
                {targetStorage.version > storedSchema && (
                  <ul>
                    {Object.entries(targetStorage.migrations)
                      .filter(([, step]) => step.from >= storedSchema)
                      .map(([name, step]) => (
                        <li key={name}>
                          {name}: schema {step.from} to {step.to}
                        </li>
                      ))}
                  </ul>
                )}
                <Button
                  disabled={
                    !!busy ||
                    !migrationVersion ||
                    ((selected === "orders" || selected === "inventory") &&
                      storedSchema === 1 &&
                      targetStorage.version === 2) ||
                    targetStorage.version <= storedSchema
                  }
                  onClick={() =>
                    void act(selected, () =>
                      command("migrate", {
                        moduleId: selected,
                        version: migrationVersion,
                      }),
                    )
                  }
                >
                  Migrate storage
                </Button>
                {(selected === "orders" || selected === "inventory") &&
                  storedSchema === 1 &&
                  targetStorage.version === 2 && (
                    <p>
                      Use Upgrade business modules in the module toolbar to
                      review access and migrate Orders and Inventory together.
                    </p>
                  )}
              </section>
            )}
            <Field label="Pinned version (empty follows current release)">
              <Input value={pin} onChange={(e) => setPin(e.target.value)} />
            </Field>
            <Field label="Require selected release">
              <Checkbox
                checked={mandatory}
                onCheckedChange={(checked) => setMandatory(!!checked)}
              />
            </Field>
            <p>
              Clients must identify their release. Updates require server
              acceptance; disconnected clients retain access until their
              existing offline lease expires. Queued work is preserved for
              review.
            </p>
            {!mandatory && (
              <section
                className="form-stack"
                aria-label="Other accepted releases"
              >
                <h3>Other accepted releases</h3>
                {migrationReleases
                  .filter((r) => r.version !== (pin || selectedModule.version))
                  .map((release) => (
                    <Field
                      key={release.version}
                      label={`Accept ${release.version}`}
                    >
                      <Checkbox
                        checked={acceptedVersions.includes(release.version)}
                        onCheckedChange={(checked) =>
                          setAcceptedVersions((versions) =>
                            checked
                              ? [...versions, release.version]
                              : versions.filter((v) => v !== release.version),
                          )
                        }
                      />
                    </Field>
                  ))}
                <p>
                  The server checks compatibility with stored data,
                  configuration and connected modules before saving.
                </p>
              </section>
            )}
            <Button
              disabled={!!busy}
              onClick={() =>
                void act(selected, () =>
                  command(
                    "rollout",
                    {
                      moduleId: selected,
                      version: pin,
                      mandatory,
                      acceptedVersions: mandatory
                        ? []
                        : acceptedVersions.filter(
                            (v) => v !== (pin || selectedModule.version),
                          ),
                    },
                    state.data?.settings.find(
                      (s) => s.key === `pin:${selected}`,
                    )?.version ?? 0,
                  ),
                )
              }
            >
              Save update policy
            </Button>
          </div>
        )}
      </Modal>
      {admin && fleetModule && (
        <ModuleFleetDialog
          key={fleetModule}
          {...props}
          moduleId={fleetModule}
          name={
            state.data?.modules.find((m) => m.id === fleetModule)?.name ??
            fleetModule
          }
          close={() => setFleetModule("")}
        />
      )}
    </section>
  );
}
