import { useMemo, useState } from "react";
import type { FeatureProps } from "@suite/client";
import {
  effectivePermissions,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import type { PlatformState } from "@suite/module-sdk/platform";
import {
  Checkbox,
  Field,
  Select,
  SelectOption,
  Table,
  SearchField,
  Pagination,
} from "@suite/ui-web";
import { PermissionOrigin } from "../permission-origin";
import { PermissionDecision } from "../permission-decision";

const pageSize = 8;

export function OrganizationMatrix({
  props,
  policy,
  state,
  permissions,
  filter,
  setFilter,
  busy,
  setBusy,
  onError,
  refresh,
}: {
  props: FeatureProps;
  policy: OrganizationPolicy;
  state: PlatformState;
  permissions: string[];
  filter: string;
  setFilter(value: string): void;
  busy: boolean;
  setBusy(value: boolean): void;
  onError(error: unknown): void;
  refresh(): Promise<unknown>;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filteredRoles = useMemo(
    () =>
      state.roles.filter((role) =>
        role.name.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [state.roles, search],
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filteredRoles.length / pageSize) - 1),
  );
  const offset = currentPage * pageSize;
  const visibleRoles = useMemo(
    () => filteredRoles.slice(offset, offset + pageSize),
    [filteredRoles, offset],
  );
  // Evaluate each role once per policy snapshot, never once per permission cell.
  const decisions = useMemo(() => {
    const grants = Object.fromEntries(
      state.roles.map((role) => [role.id, role.permissions]),
    );
    const result = new Map<string, ReturnType<typeof effectivePermissions>>();
    for (const role of visibleRoles) {
      try {
        result.set(role.id, effectivePermissions([role.id], grants, policy));
      } catch {
        /* Draft cycles remain editable; save validates them. */
      }
    }
    return result;
  }, [state.roles, policy, visibleRoles]);
  return (
    <section className="panel organization-section permission-section">
      <h2>Permission matrix</h2>
      <p>Review each role’s access and where its permissions come from.</p>
      <Field label="Module">
        <Select value={filter} onValueChange={setFilter}>
          <SelectOption value="">All modules</SelectOption>
          {[
            ...state.modules,
            ...(state.unavailableModules ?? []).map((m) => ({
              id: m.moduleId,
              name: m.name,
            })),
          ].map((m) => (
            <SelectOption value={m.id} key={m.id}>
              {m.name}
            </SelectOption>
          ))}
        </Select>
      </Field>
      <SearchField
        placeholder="Search matrix roles"
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
      />
      <p role="status">
        {filteredRoles.length
          ? `Roles ${offset + 1}–${offset + visibleRoles.length} of ${filteredRoles.length}`
          : "No matching roles"}
      </p>
      {filteredRoles.length > pageSize && (
        <Pagination
          hasPrevious={currentPage > 0}
          next={offset + pageSize < filteredRoles.length ? "next" : undefined}
          onPrevious={() => setPage(currentPage - 1)}
          onNext={() => setPage(currentPage + 1)}
          pending={busy}
        />
      )}
      <div
        className="table-scroll permission-scroll"
        data-role-count={visibleRoles.length}
        tabIndex={0}
        role="region"
        aria-label="Permission matrix"
      >
        <Table className="module-table">
          <thead>
            <tr>
              <th>Permission</th>
              {visibleRoles.map((r) => (
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
                    entries={state.permissionCatalog?.filter(
                      (entry) => entry.permission === permission,
                    )}
                  />
                </th>
                {visibleRoles.map((role) => {
                  const result = decisions.get(role.id);
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
                            await refresh();
                          } catch (e) {
                            onError(e);
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
                                state.roles.find((r) => r.id === id)?.name ??
                                id,
                            ),
                            denies: (source?.denies ?? []).map(
                              (id) =>
                                policy.ranks.find((r) => r.id === id)?.name ??
                                state.roles.find((r) => r.id === id)?.name ??
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
  );
}
