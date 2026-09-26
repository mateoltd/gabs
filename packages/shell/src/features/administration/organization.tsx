import { RoleRemoval } from "./organization/removal";
import type { RoleDetails } from "@suite/contracts";
import { OrganizationRoles } from "./organization/roles";
import { OrganizationChart } from "./organization/chart";
import { OrganizationMatrix } from "./organization/matrix";
import { OrganizationGroups } from "./organization/groups";
import { OrganizationTags } from "./organization/tags";
import "./organization/classification.css";
import { type FeatureProps } from "@suite/client";
import {
  layoutOrganization,
  validateOrganization,
  organizationIssues,
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
  SearchSelect,
} from "@suite/ui-web";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
    [classificationFilter, setClassificationFilter] = useState(""),
    [filter, setFilter] = useState(searchParams.get("module") ?? "");
  const [removing, setRemoving] = useState<RoleDetails>();
  const reloadButton = useRef<HTMLButtonElement>(null);
  const matchDescription = useId();
  const issues = useMemo(
    () => (policy ? organizationIssues(policy) : []),
    [policy],
  );
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
  const classifications = [
    ...policy.groups.map((group) => ({
      value: `group:${group.id}`,
      label: `Group: ${group.name}`,
      rankIds: group.rankIds,
    })),
    ...(policy.tags ?? []).map((tag) => ({
      value: `tag:${tag.id}`,
      label: `Tag: ${tag.name}`,
      rankIds: tag.rankIds,
    })),
  ];
  const classification = classifications.find(
    (item) => item.value === classificationFilter,
  );
  const matchingRanks = new Set(
    policy.ranks
      .filter((r) => classification?.rankIds.includes(r.id))
      .map((r) => r.id),
  );
  const policyPermissions = [
    ...new Set([
      ...productPermissions,
      ...(state.data.permissionCatalog?.map((entry) => entry.permission) ??
        state.data.modules.flatMap((m) => m.permissions)),
    ]),
  ];
  const permissions = policyPermissions.filter(
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
            ...(normalized.tags ? { tags: normalized.tags } : {}),
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
            disabled={!dirty || busy || issues.length > 0}
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
            ref={reloadButton}
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
          <Button
            disabled={busy || issues.length > 0}
            onClick={() => update((p) => layoutOrganization(p))}
          >
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
      <section
        className="organization-classification"
        aria-label="Chart classification filter"
      >
        <Field label="Highlight group or tag">
          <SearchSelect
            options={classifications}
            value={classification?.value ?? ""}
            onValueChange={setClassificationFilter}
            placeholder="Search groups and role tags"
            clearLabel="Clear chart filter"
          />
        </Field>
        <p role="status">
          {classification
            ? `${matchingRanks.size} of ${policy.ranks.length} roles match ${classification.label}.`
            : "All roles shown. Choose a group or tag to highlight its roles."}
        </p>
        <span id={matchDescription} className="sr-only">
          Matches the chart classification filter.
        </span>
      </section>
      {!!issues.length && (
        <section className="notice" aria-label="Organization issues">
          <h2>Review organization changes</h2>
          <p role="alert">
            Resolve these issues before saving or arranging the chart. Your
            draft is preserved.
          </p>
          <ul>
            {issues.map((issue, index) => {
              const affected = policy.ranks.filter((item) =>
                issue.rankIds.includes(item.id),
              );
              return (
                <li key={`${issue.code}:${index}`}>
                  <p>
                    {issue.message}{" "}
                    {issue.code === "assignment"
                      ? "Review the group or tag assignments below."
                      : affected.length
                        ? `${affected.length} ${affected.length === 1 ? "role needs" : "roles need"} review.`
                        : ""}
                  </p>
                  {affected[0] && (
                    <Button
                      variant="ghost"
                      onClick={() => setSelected(affected[0].id)}
                    >
                      Review {affected[0].name}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <OrganizationChart
        policy={policy}
        issues={issues}
        zoom={zoom}
        matchingRanks={matchingRanks}
        matchDescription={matchDescription}
        onSelect={setSelected}
        onChange={(value) => update(() => value)}
      />
      <OrganizationGroups
        policy={policy}
        modules={state.data.modules}
        canAssignModules={props.bootstrap.permissions.includes(
          "modules.manage",
        )}
        permissions={policyPermissions}
        disabled={busy}
        onChange={(value) => update(() => value)}
      />
      <OrganizationTags
        policy={policy}
        modules={state.data.modules}
        canAssignModules={props.bootstrap.permissions.includes(
          "modules.manage",
        )}
        permissions={policyPermissions}
        disabled={busy}
        onChange={(value) => update(() => value)}
      />
      <OrganizationMatrix
        invalid={issues.length > 0}
        props={props}
        policy={policy}
        state={state.data}
        permissions={permissions}
        filter={filter}
        setFilter={setFilter}
        busy={busy}
        setBusy={setBusy}
        onError={setError}
        refresh={state.refetch}
      />
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
            {issues.some((issue) => issue.rankIds.includes(rank.id)) && (
              <p role="alert">
                {issues
                  .filter((issue) => issue.rankIds.includes(rank.id))
                  .map((issue) => issue.message)
                  .join(" ")}
              </p>
            )}
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
                <OrganizationRoles
                  key={rank.id}
                  roles={policy.ranks.filter((item) => item.id !== rank.id)}
                  selected={rank.parents}
                  searchLabel="Search parent roles"
                  disabled={busy}
                  onChange={(parents) =>
                    update((p) => ({
                      ...p,
                      ranks: p.ranks.map((item) =>
                        item.id === rank.id ? { ...item, parents } : item,
                      ),
                    }))
                  }
                />
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
            {state.data.roles.some(
              (role) => role.id === rank.id && !role.protected,
            ) && (
              <>
                {dirty && (
                  <p>
                    Save or reload your organization changes before removing a
                    role.
                  </p>
                )}
                <Button
                  variant="danger"
                  disabled={busy || dirty || !props.online}
                  onClick={() => {
                    setRemoving(
                      state.data!.roles.find((role) => role.id === rank.id),
                    );
                    setSelected("");
                  }}
                >
                  Remove role
                </Button>
              </>
            )}
            <Button onClick={() => setSelected("")}>Done</Button>
          </div>
        )}
      </Modal>
      {removing && (
        <RoleRemoval
          key={removing.id}
          props={props}
          role={removing}
          organizationVersion={version}
          returnFocusRef={reloadButton}
          onClose={() => setRemoving(undefined)}
          onRemoved={async () => {
            const current = await state.refetch();
            if (current.error) throw current.error;
            await qc.invalidateQueries({
              queryKey: [props.scope.userId, props.scope.workspaceId, "roles"],
            });
          }}
        />
      )}
    </>
  );
}
