import { Table } from "@suite/ui-web";
import { PERMISSIONS } from "@suite/contracts";
import { deviceId, installModule } from "./module-installation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { moduleDefinition } from "@suite/module-catalog";
import { canonical, resolveReleases } from "@suite/module-sdk/registry";
import type { SignedArtifact } from "@suite/module-sdk/platform";
import {
  effectivePermissions,
  validateOrganization,
  layoutOrganization,
  type OrganizationPolicy,
  type Rank,
} from "@suite/module-sdk/governance";
import { type FeatureProps } from "@suite/platform";
import {
  changeModuleStorage,
  readModuleStorage,
} from "@suite/platform/module-storage";
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  SelectOption,
  Modal,
  SchemaForm,
  PageHeading,
  ErrorMessage,
  Loading,
  Empty,
  type FormSchema,
  Badge,
  fieldLabel,
} from "@suite/ui-web";
import { navigationIcons } from "@suite/ui-web/icons";
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
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(""),
    [selected, setSelected] = useState(""),
    [config, setConfig] = useState<Record<string, unknown>>({}),
    [pin, setPin] = useState("");
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
    try {
      await fn();
      await qc.invalidateQueries({
        queryKey: [props.scope.userId, props.scope.workspaceId],
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  };
  const install = (id: string) => installModule(props, state.data!, id, true);
  if (state.isPending) return <Loading />;
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
      </div>
      <ErrorMessage error={error ?? state.error} />
      <div className="module-grid">
        {state.data?.modules.map((module) => {
          const installation = state.data.installations.find(
            (i) =>
              i.module_id === module.id &&
              i.device_id === deviceId() &&
              i.state === "installed",
          );
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
                    ? `Installed ${installation.version}`
                    : "Not installed on this device"}
                </Badge>
              </div>
              <p className="small">
                {published
                  ? "Signed release available"
                  : "A signed release has not been published"}
              </p>
              <div className="module-toolbar">
                <Button
                  disabled={
                    !!busy ||
                    !published ||
                    !entitlement?.assigned ||
                    !entitlement.entitled ||
                    entitlement.state !== "enabled"
                  }
                  onClick={() => void act(module.id, () => install(module.id))}
                >
                  {installation ? "Verify and repair" : "Install"}
                </Button>
                {installation && (
                  <Button
                    disabled={!!busy}
                    onClick={() =>
                      void act(module.id, async () => {
                        await command("uninstall", {
                          moduleId: module.id,
                          deviceId: deviceId(),
                        });
                        await changeModuleStorage(
                          props.platform,
                          props.scope,
                          (s) => {
                            delete s.installed[module.id];
                          },
                        );
                      })
                    }
                  >
                    Uninstall
                  </Button>
                )}
                {admin && (
                  <Button
                    onClick={() => {
                      setSelected(module.id);
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
                    }}
                  >
                    Configure
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
        title={`Configure ${moduleDefinition(selected)?.name ?? selected}`}
        description="Configure required parameters, review grants, and publish to employees."
      >
        {selected && (
          <div className="form-stack">
            <SchemaForm
              schema={moduleDefinition(selected)!.configuration as FormSchema}
              value={config}
              onChange={setConfig}
            />
            <Button
              disabled={!!busy}
              onClick={() =>
                void act(selected, async () => {
                  const activation = props.bootstrap.modules.find(
                    (m) => m.moduleId === selected,
                  )!;
                  await props.client.request({
                    operation: "moduleEdit",
                    params: {
                      workspaceId: props.scope.workspaceId,
                      moduleId: selected,
                    },
                    body: {
                      state: "enabled",
                      accessPolicy: activation.accessPolicy,
                      config,
                    },
                  });
                  setSelected("");
                })
              }
            >
              Validate and publish
            </Button>
            {Object.keys(moduleDefinition(selected)!.dependencies).map(
              (dep) => {
                const grant = state.data?.settings.find(
                  (s) => s.key === `grant:${selected}:${dep}`,
                );
                const services = Array.isArray(grant?.value.services)
                  ? (grant.value.services as string[])
                  : [];
                const publicOperations = Object.entries(
                  state.data?.modules.find((m) => m.id === dep)?.operations ??
                    {},
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
              },
            )}
            <Field label="Pinned version (empty follows current release)">
              <Input value={pin} onChange={(e) => setPin(e.target.value)} />
            </Field>
            <Button
              onClick={() =>
                void act(selected, () =>
                  command(
                    "pin",
                    { moduleId: selected, version: pin, mandatory: true },
                    state.data?.settings.find(
                      (s) => s.key === `pin:${selected}`,
                    )?.version ?? 0,
                  ),
                )
              }
            >
              Save update policy
            </Button>
            <ErrorMessage error={error} />
          </div>
        )}
      </Modal>
    </section>
  );
}
export function Organization(props: FeatureProps) {
  const [searchParams] = useSearchParams();
  const state = usePlatformState(props),
    qc = useQueryClient();
  const [policy, setPolicy] = useState<OrganizationPolicy>(),
    [version, setVersion] = useState(0),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(""),
    [zoom, setZoom] = useState(1),
    [newRole, setNewRole] = useState(""),
    [filter, setFilter] = useState(searchParams.get("module") ?? "");
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state.data?.organization && !dirty) {
      setPolicy(state.data.organization);
      setVersion(state.data.organization.version);
    }
  }, [state.data, dirty]);
  if (!props.bootstrap.permissions.includes("roles.manage"))
    return (
      <Empty
        title="Administrator access required"
        description="Your role does not allow organization management."
      />
    );
  if (!policy || !state.data) return <Loading />;
  const update = (fn: (p: OrganizationPolicy) => OrganizationPolicy) => {
    setPolicy(fn(policy));
    setDirty(true);
  };
  const rank = policy.ranks.find((r) => r.id === selected);
  const grantMap = Object.fromEntries(
    state.data.roles.map((r) => [r.id, r.permissions]),
  );
  const permissions = [
    ...new Set([
      ...PERMISSIONS,
      ...state.data.modules.flatMap((m) => m.permissions),
    ]),
  ].filter((p) => !filter || p.startsWith(filter + "."));
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const normalized = {
        ...policy!,
        ranks: policy!.ranks.map((r) => ({
          ...r,
          denies: [...new Set(r.denies.filter(Boolean))],
        })),
        groups: policy!.groups.map((g) => ({
          ...g,
          tags: [...new Set(g.tags.filter(Boolean))],
          grants: [...new Set(g.grants.filter(Boolean))],
          denies: [...new Set(g.denies.filter(Boolean))],
        })),
      };
      validateOrganization(normalized);
      await props.client.request({
        operation: "platformCommand",
        params: { workspaceId: props.scope.workspaceId },
        body: {
          action: "organization",
          value: {
            rootId: normalized.rootId,
            ranks: normalized.ranks,
            groups: normalized.groups,
          },
          version,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      setDirty(false);
      await state.refetch();
      await qc.invalidateQueries({
        queryKey: [props.scope.userId, props.scope.workspaceId, "bootstrap"],
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Organization and permissions"
        description="Structure your organization, delegate access, and inspect effective permissions."
        actions={
          <Button
            disabled={!dirty || busy}
            variant="primary"
            onClick={() => void save()}
          >
            Save organization
          </Button>
        }
      />
      <ErrorMessage error={error ?? state.error} />
      <div className="organization-toolbar">
        <div className="actions">
          <Button
            onClick={() => {
              setDirty(false);
              void state.refetch();
            }}
          >
            Reload
          </Button>
          <Button onClick={() => setZoom(Math.min(2, zoom + 0.2))}>
            Zoom in
          </Button>
          <Button onClick={() => setZoom(Math.max(0.4, zoom - 0.2))}>
            Zoom out
          </Button>
          <Button onClick={() => update((p) => layoutOrganization(p))}>
            Arrange
          </Button>
        </div>
        <div className="organization-role-create">
          <Field label="New role">
            <Input
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            />
          </Field>
          <Button
            disabled={!newRole || dirty}
            onClick={async () => {
              try {
                await props.client.request({
                  operation: "roleCreate",
                  params: { workspaceId: props.scope.workspaceId },
                  body: { name: newRole, permissions: [] },
                });
                setNewRole("");
                await state.refetch();
              } catch (e) {
                setError(e);
              }
            }}
          >
            Add role
          </Button>
        </div>
      </div>
      <div className="organization-canvas">
        <svg
          ref={svg}
          viewBox={`0 0 ${1000 / zoom} ${500 / zoom}`}
          role="group"
          aria-roledescription="Organization chart"
          aria-label="Organization hierarchy"
          onPointerMove={(e) => {
            if (!dragging.current || !svg.current) return;
            const rect = svg.current.getBoundingClientRect();
            const x =
                Math.round(
                  (((e.clientX - rect.left) / rect.width) * (1000 / zoom) -
                    80) /
                    10,
                ) * 10,
              y =
                Math.round(
                  (((e.clientY - rect.top) / rect.height) * (500 / zoom) - 25) /
                    10,
                ) * 10;
            const id = dragging.current;
            update((p) => ({
              ...p,
              ranks: p.ranks.map((r) =>
                r.id === id
                  ? { ...r, x: Math.max(0, x), y: Math.max(0, y) }
                  : r,
              ),
            }));
          }}
          onPointerUp={() => {
            dragging.current = undefined;
          }}
        >
          {policy.ranks.flatMap((r) =>
            r.parents.map((id) => {
              const p = policy.ranks.find((n) => n.id === id);
              return p ? (
                <path
                  key={`${id}/${r.id}`}
                  d={`M${p.x + 80},${p.y + 50} L${r.x + 80},${r.y}`}
                  fill="none"
                  stroke="currentColor"
                />
              ) : null;
            }),
          )}
          {policy.ranks.map((r) => (
            <g
              key={r.id}
              role="button"
              tabIndex={0}
              aria-label={`Configure ${r.name}`}
              transform={`translate(${r.x},${r.y})`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelected(r.id);
                }
              }}
              onClick={() => setSelected(r.id)}
              onPointerDown={(e) => {
                dragging.current = r.id;
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
            >
              <rect
                width="160"
                height="50"
                rx="8"
                fill="var(--surface)"
                stroke="currentColor"
              />
              <text x="10" y="30" fill="currentColor">
                {r.name.slice(0, 20)}
              </text>
            </g>
          ))}
        </svg>
        <svg
          className="organization-minimap"
          viewBox="0 0 1000 500"
          aria-label="Organization overview"
        >
          {policy.ranks.map((r) => (
            <rect
              key={r.id}
              x={r.x}
              y={r.y}
              width="160"
              height="50"
              fill="currentColor"
            />
          ))}
        </svg>
      </div>
      <section className="panel organization-section">
        <div className="row-between">
          <h2>Groups and tags</h2>
          <Button
            onClick={() =>
              update((p) => ({
                ...p,
                groups: [
                  ...p.groups,
                  {
                    id: crypto.randomUUID(),
                    name: "New group",
                    rankIds: [],
                    tags: [],
                    grants: [],
                    denies: [],
                  },
                ],
              }))
            }
          >
            Add group
          </Button>
        </div>
        {!policy.groups.length && (
          <p className="organization-empty">
            No groups yet. Group roles to apply shared permissions and tags.
          </p>
        )}
        {policy.groups.map((g) => (
          <fieldset key={g.id} className="form-stack organization-group">
            <legend>{g.name}</legend>
            <Field label="Group name">
              <Input
                value={g.name}
                onChange={(e) =>
                  update((p) => ({
                    ...p,
                    groups: p.groups.map((x) =>
                      x.id === g.id ? { ...x, name: e.target.value } : x,
                    ),
                  }))
                }
              />
            </Field>
            <Field label="Tags (comma separated)">
              <Input
                value={g.tags.join(", ")}
                onChange={(e) =>
                  update((p) => ({
                    ...p,
                    groups: p.groups.map((x) =>
                      x.id === g.id
                        ? {
                            ...x,
                            tags: e.target.value
                              .split(",")
                              .map((v) => v.trim()),
                          }
                        : x,
                    ),
                  }))
                }
              />
            </Field>
            <div className="module-toolbar">
              {policy.ranks.map((r) => (
                <label key={r.id} className="check-row">
                  <Checkbox
                    checked={g.rankIds.includes(r.id)}
                    onCheckedChange={(checked) =>
                      update((p) => ({
                        ...p,
                        groups: p.groups.map((x) =>
                          x.id === g.id
                            ? {
                                ...x,
                                rankIds: checked
                                  ? [...x.rankIds, r.id]
                                  : x.rankIds.filter((id) => id !== r.id),
                              }
                            : x,
                        ),
                      }))
                    }
                  />
                  {r.name}
                </label>
              ))}
            </div>
            <Field label="Granted permissions (comma separated)">
              <Input
                value={g.grants.join(", ")}
                onChange={(e) =>
                  update((p) => ({
                    ...p,
                    groups: p.groups.map((x) =>
                      x.id === g.id
                        ? {
                            ...x,
                            grants: e.target.value
                              .split(",")
                              .map((v) => v.trim()),
                          }
                        : x,
                    ),
                  }))
                }
              />
            </Field>
            <Field label="Denied permissions (comma separated)">
              <Input
                value={g.denies.join(", ")}
                onChange={(e) =>
                  update((p) => ({
                    ...p,
                    groups: p.groups.map((x) =>
                      x.id === g.id
                        ? {
                            ...x,
                            denies: e.target.value
                              .split(",")
                              .map((v) => v.trim()),
                          }
                        : x,
                    ),
                  }))
                }
              />
            </Field>
            <Button
              onClick={() =>
                update((p) => ({
                  ...p,
                  groups: p.groups.filter((x) => x.id !== g.id),
                }))
              }
            >
              Remove group
            </Button>
          </fieldset>
        ))}
      </section>
      <section className="panel organization-section permission-section">
        <h2>Permission matrix</h2>
        <p>Review each role’s access and where its permissions come from.</p>
        <Field label="Module">
          <Select value={filter} onValueChange={setFilter}>
            <SelectOption value="">All modules</SelectOption>
            {state.data.modules.map((m) => (
              <SelectOption value={m.id} key={m.id}>
                {m.name}
              </SelectOption>
            ))}
          </Select>
        </Field>
        <div
          className="table-scroll permission-scroll"
          tabIndex={0}
          role="region"
          aria-label="Permission matrix"
        >
          <Table className="module-table">
            <thead>
              <tr>
                <th>Permission</th>
                {state.data.roles.map((r) => (
                  <th key={r.id}>{r.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((permission) => (
                <tr key={permission}>
                  <th scope="row">
                    <span className="permission-name">
                      {permission
                        .split(".")
                        .map((part) => part.replaceAll("_", " "))
                        .join(" / ")}
                    </span>
                  </th>
                  {state.data.roles.map((role) => {
                    let result;
                    try {
                      result = effectivePermissions(
                        [role.id],
                        grantMap,
                        policy,
                      );
                    } catch {}
                    const source = result?.sources[permission];
                    return (
                      <td key={role.id}>
                        <Checkbox
                          aria-label={`${role.name}: ${permission}`}
                          checked={role.permissions.includes(permission)}
                          disabled={role.protected || busy}
                          onCheckedChange={async (checked) => {
                            setBusy(true);
                            try {
                              await props.client.request({
                                operation: "roleEdit",
                                params: {
                                  workspaceId: props.scope.workspaceId,
                                  id: role.id,
                                },
                                body: {
                                  name: role.name,
                                  permissions: checked
                                    ? [...role.permissions, permission]
                                    : role.permissions.filter(
                                        (p) => p !== permission,
                                      ),
                                },
                              });
                              await state.refetch();
                            } catch (e) {
                              setError(e);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        />
                        <small>
                          {source?.denies.length
                            ? "Denied by " + source.denies.join(", ")
                            : result?.permissions.includes(permission)
                              ? "Allowed by " +
                                (source?.grants
                                  .map(
                                    (id) =>
                                      policy.ranks.find((r) => r.id === id)
                                        ?.name ?? id,
                                  )
                                  .join(", ") ?? "policy")
                              : "No access"}
                        </small>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </section>
      <Modal
        open={!!rank}
        onOpenChange={(v) => {
          if (!v) setSelected("");
        }}
        title={rank?.name ?? "Rank"}
        description="Choose reporting relationships and permission inheritance."
      >
        {rank && (
          <div className="form-stack">
            {rank.id !== policy.rootId && (
              <>
                <Field label="Inherit parent permissions">
                  <Checkbox
                    checked={rank.inherit}
                    onCheckedChange={(inherit) =>
                      update((p) => ({
                        ...p,
                        ranks: p.ranks.map((r) =>
                          r.id === rank.id ? { ...r, inherit } : r,
                        ),
                      }))
                    }
                  />
                </Field>
                <h3>Parents</h3>
                {policy.ranks
                  .filter((r) => r.id !== rank.id)
                  .map((parent) => (
                    <label key={parent.id} className="check-row">
                      <Checkbox
                        checked={rank.parents.includes(parent.id)}
                        onCheckedChange={(checked) =>
                          update((p) => ({
                            ...p,
                            ranks: p.ranks.map((r) =>
                              r.id === rank.id
                                ? {
                                    ...r,
                                    parents: checked
                                      ? [...r.parents, parent.id]
                                      : r.parents.filter(
                                          (id) => id !== parent.id,
                                        ),
                                  }
                                : r,
                            ),
                          }))
                        }
                      />
                      {parent.name}
                    </label>
                  ))}
                <Field label="Explicit denials (comma separated)">
                  <Input
                    value={rank.denies.join(", ")}
                    onChange={(e) =>
                      update((p) => ({
                        ...p,
                        ranks: p.ranks.map((r) =>
                          r.id === rank.id
                            ? {
                                ...r,
                                denies: e.target.value
                                  .split(",")
                                  .map((v) => v.trim()),
                              }
                            : r,
                        ),
                      }))
                    }
                  />
                </Field>
              </>
            )}
            <Button onClick={() => setSelected("")}>Done</Button>
          </div>
        )}
      </Modal>
    </>
  );
}
export function Appearance(props: FeatureProps) {
  const state = usePlatformState(props);
  const [error, setError] = useState<unknown>();
  const setting = state.data?.settings.find((s) => s.key === "appearance");
  const current = String(setting?.value.archetype ?? "modern-dark");
  return (
    <section className="panel">
      <h2>Workspace appearance</h2>
      <Field label="Design archetype">
        <Select
          value={current}
          disabled={!props.bootstrap.permissions.includes("workspace.manage")}
          onValueChange={async (archetype) => {
            try {
              await props.client.request({
                operation: "platformCommand",
                params: { workspaceId: props.scope.workspaceId },
                body: {
                  action: "appearance",
                  value: { archetype },
                  version: setting?.version ?? 0,
                },
                idempotencyKey: crypto.randomUUID(),
              });
              await state.refetch();
            } catch (e) {
              setError(e);
            }
          }}
        >
          {archetypes.map((a) => (
            <SelectOption key={a} value={a}>
              {fieldLabel(a)}
            </SelectOption>
          ))}
        </Select>
      </Field>
      <ErrorMessage error={error} />
    </section>
  );
}
export function Billing(props: FeatureProps) {
  const state = useQuery({
    queryKey: [props.scope.userId, props.scope.workspaceId, "billing"],
    enabled:
      props.online && props.bootstrap.permissions.includes("billing.manage"),
    queryFn: () =>
      props.client.request({
        operation: "billingState",
        params: { workspaceId: props.scope.workspaceId },
      }),
  });
  const [modules, setModules] = useState<string[]>([]),
    [seats, setSeats] = useState(props.bootstrap.seatLimit),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  if (!props.bootstrap.permissions.includes("billing.manage")) return null;
  async function act(action: "checkout" | "portal" | "reconcile") {
    setBusy(true);
    try {
      const result = await props.client.request({
        operation: "billingCommand",
        params: { workspaceId: props.scope.workspaceId },
        body: { action, modules, seats },
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.url) {
        const url = new URL(result.url);
        if (
          url.protocol !== "https:" ||
          !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
        )
          throw Error("Unexpected billing destination.");
        if (window.suiteDesktop)
          await window.suiteDesktop.openBilling(url.href);
        else window.location.assign(url.href);
      }
      await state.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Billing and licenses</h2>
      <ErrorMessage error={error ?? state.error} />
      {state.data?.configured ? (
        <>
          <p>Subscription: {state.data.status}</p>
          <Field label="Seats">
            <Input
              type="number"
              min="1"
              max="100000"
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
            />
          </Field>
          {state.data.modules.map((id) => (
            <label key={id} className="check-row">
              <Checkbox
                checked={modules.includes(id)}
                onCheckedChange={(checked) =>
                  setModules(
                    checked
                      ? [...modules, id]
                      : modules.filter((m) => m !== id),
                  )
                }
              />
              {moduleDefinition(id)?.name ?? id}
            </label>
          ))}
          <div className="module-toolbar">
            <Button
              disabled={busy || state.data.subscribed || !modules.length}
              onClick={() => void act("checkout")}
            >
              Purchase subscription
            </Button>
            <Button
              disabled={busy || !state.data.subscribed}
              onClick={() => void act("portal")}
            >
              Manage subscription
            </Button>
            <Button
              disabled={busy || !state.data.subscribed}
              onClick={() => void act("reconcile")}
            >
              Refresh entitlements
            </Button>
          </div>
          <p>
            Access changes after the payment provider confirms your
            subscription.
          </p>
        </>
      ) : (
        <p>
          Billing is unavailable until this deployment connects its payment
          provider and module prices.
        </p>
      )}
    </section>
  );
}
export function LocalNetwork(props: FeatureProps) {
  const native = window.suiteDesktop;
  const state = useQuery({
    queryKey: [props.scope.userId, props.scope.workspaceId, "lan"],
    enabled: !!native,
    queryFn: () => native!.lanStatus(),
    refetchInterval: 15000,
  });
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  if (!native || !props.bootstrap.permissions.includes("modules.manage"))
    return null;
  return (
    <section className="panel">
      <h2>Local network</h2>
      <p>
        {state.data?.configured
          ? "Exchange authorized packages and pending changes with managed devices. Business changes still need server acceptance."
          : "Managed device certificates and a peer policy are required before local networking can be enabled."}
      </p>
      <p>
        {state.data?.enabled
          ? `${state.data.peers.length} peers connected`
          : "Disabled"}
      </p>
      <Button
        disabled={busy || !state.data?.configured}
        onClick={async () => {
          setBusy(true);
          try {
            await native.setLan(props.scope, !state.data?.enabled);
            await state.refetch();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {state.data?.enabled ? "Disable local network" : "Enable local network"}
      </Button>
      <ErrorMessage error={error} />
    </section>
  );
}
