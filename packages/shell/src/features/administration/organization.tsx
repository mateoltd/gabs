import { PermissionOrigin } from "./permission-origin";
import { PermissionDecision } from "./permission-decision";
import { type FeatureProps } from "@suite/client";
import {
  effectivePermissions,
  layoutOrganization,
  validateOrganization,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import {
  Button,
  Checkbox,
  Empty,
  ErrorMessage,
  Field,
  Input,
  Loading,
  Modal,
  PageHeading,
  Select,
  SelectOption,
  Table,
} from "@suite/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useShellComposition } from "../../app/composition";
import { usePlatformState } from "./module-lifecycle";
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
export function Organization(props: FeatureProps) {
  const { permissions: productPermissions } = useShellComposition();
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
      ...productPermissions,
      ...(state.data.permissionCatalog?.map((entry) => entry.permission) ??
        state.data.modules.flatMap((m) => m.permissions)),
    ]),
  ].filter(
    (permission) =>
      !filter ||
      (state.data.permissionCatalog
        ? state.data.permissionCatalog.some(
            (entry) =>
              entry.moduleId === filter && entry.permission === permission,
          )
        : permission.startsWith(filter + ".")),
  );
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
                    <PermissionOrigin
                      entries={state.data.permissionCatalog?.filter(
                        (entry) => entry.permission === permission,
                      )}
                    />
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
                        <PermissionDecision
                          decision={
                            result && {
                              allowed: result.permissions.includes(permission),
                              grants: (source?.grants ?? []).map(
                                (id) =>
                                  policy.ranks.find((r) => r.id === id)?.name ??
                                  state.data.roles.find((r) => r.id === id)
                                    ?.name ??
                                  id,
                              ),
                              denies: (source?.denies ?? []).map(
                                (id) =>
                                  policy.ranks.find((r) => r.id === id)?.name ??
                                  state.data.roles.find((r) => r.id === id)
                                    ?.name ??
                                  id,
                              ),
                            }
                          }
                        />
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
