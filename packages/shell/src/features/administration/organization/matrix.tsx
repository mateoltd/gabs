import { ApiError } from "@suite/client/api";
import { PLATFORM_PERMISSIONS, type RoleEdit } from "@suite/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureProps } from "@suite/client";
import {
  effectivePermissions,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import type { PlatformState } from "@suite/module-sdk/platform";
import {
  Button,
  ErrorMessage,
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
  invalid = false,
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
  invalid?: boolean;
  policy: OrganizationPolicy;
  state: PlatformState;
  permissions: string[];
  filter: string;
  setFilter(value: string): void;
  busy: boolean;
  setBusy(value: boolean): void;
  onError(error: unknown): void;
  refresh(): Promise<{ error: unknown }>;
}) {
  const [pending, setPending] = useState<{
    id: string;
    body: RoleEdit;
    key: string;
    error?: unknown;
  }>();
  const matrix = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!busy && !pending && restoreFocus.current) {
      restoreFocus.current = false;
      matrix.current?.focus();
    }
  }, [busy, pending]);
  const conflict =
    pending?.error instanceof ApiError && pending.error.code === "ROLE_CHANGED";
  const apply = async (attempt: NonNullable<typeof pending>) => {
    setBusy(true);
    setPending(attempt);
    try {
      await props.client.request({
        operation: "roleEdit",
        params: { workspaceId: props.scope.workspaceId, id: attempt.id },
        body: attempt.body,
        idempotencyKey: attempt.key,
      });
    } catch (cause) {
      setPending({
        ...attempt,
        error:
          cause instanceof ApiError
            ? cause
            : new Error(
                "The permission change could not be confirmed. Retry to check its saved result.",
              ),
      });
      setBusy(false);
      return;
    }
    setPending(undefined);
    try {
      await reload();
    } finally {
      setBusy(false);
    }
  };
  const reload = async () => {
    try {
      const result = await refresh();
      if (result.error) throw result.error;
      restoreFocus.current = !!pending;
      setPending(undefined);
    } catch (error) {
      onError(error);
    }
  };
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
    if (invalid) return result;
    for (const role of visibleRoles) {
      try {
        result.set(role.id, effectivePermissions([role.id], grants, policy));
      } catch {
        /* Draft cycles remain editable; save validates them. */
      }
    }
    return result;
  }, [state.roles, policy, visibleRoles, invalid]);
  return (
    <section className="panel organization-section permission-section">
      <h2>Permission matrix</h2>
      <p>Review each role’s access and where its permissions come from.</p>
      {invalid && (
        <p role="status">
          Resolve organization issues to preview effective permissions.
        </p>
      )}
      {pending?.error !== undefined && (
        <section aria-label="Permission change review" className="notice">
          {conflict ? (
            <p role="alert">
              This role changed. Reload current roles before reviewing the
              permission again.
            </p>
          ) : (
            <ErrorMessage error={pending.error} />
          )}
          <p>{pending.body.name}</p>
          {!conflict && (
            <Button disabled={busy} onClick={() => void apply(pending)}>
              Retry permission change
            </Button>
          )}
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await reload();
              } finally {
                setBusy(false);
              }
            }}
          >
            Reload current roles
          </Button>
        </section>
      )}
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
        ref={matrix}
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
                        disabled={
                          invalid ||
                          role.protected ||
                          (PLATFORM_PERMISSIONS as readonly string[]).includes(
                            permission,
                          ) ||
                          busy ||
                          !!pending
                        }
                        onCheckedChange={(checked) =>
                          void apply({
                            id: role.id,
                            key: crypto.randomUUID(),
                            body: {
                              revision: role.revision,
                              name: role.name,
                              permissions: checked
                                ? [...role.permissions, permission]
                                : role.permissions.filter(
                                    (p) => p !== permission,
                                  ),
                            },
                          })
                        }
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
