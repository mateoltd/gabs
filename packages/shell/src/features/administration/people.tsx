import { ApiError } from "@suite/client/api";
import { PermissionOrigin } from "./permission-origin";
import { type FeatureProps } from "@suite/client";
import {
  PLATFORM_PERMISSIONS,
  type MemberSchema,
  type Permission,
  type RoleDetailsSchema,
  type Static,
} from "@suite/contracts";
import {
  Button,
  Checkbox,
  ContentSkeleton,
  Empty,
  ErrorMessage,
  Field,
  Input,
  ListPage,
  ListTable,
  ListToolbar,
  Modal,
  PageHeading,
  Pagination,
  RecordIdentity,
  ResultsMotion,
  SearchField,
  SegmentedControl,
  Select,
  SelectOption,
  Status,
  SummaryStrip,
} from "@suite/ui-web";
import { ArrowRight, Plus, Shield, UserPlus } from "@suite/ui-web/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useShellComposition } from "../../app/composition";
import { usePlatformState } from "./platform-admin";
type Member = Static<typeof MemberSchema>;
type Role = Static<typeof RoleDetailsSchema>;
const permissionLabels: Record<Permission, string> = {
  "workspace.manage": "Manage workspace settings",
  "members.manage": "Manage members",
  "roles.manage": "Manage roles",
  "modules.manage": "Manage modules",
  "audit.read": "View audit history",
  "orders.read": "View orders",
  "orders.create": "Create orders",
  "orders.edit": "Edit order drafts",
  "orders.confirm": "Confirm orders and reserve stock",
  "orders.fulfill": "Fulfill orders",
  "orders.cancel": "Cancel orders",
  "orders.export": "Export orders",
  "inventory.read": "View stock and movements",
  "inventory.availability.read": "View available stock",
  "inventory.products.manage": "Manage products",
  "inventory.receive": "Receive stock",
  "inventory.adjust": "Adjust stock",
};
const permissionLabel = (permission: string) =>
  permissionLabels[permission as Permission] ?? permission;
export function People(props: FeatureProps) {
  const { catalog, businessPermissions: productBusinessPermissions } =
    useShellComposition();
  const moduleState = usePlatformState(props);
  const moduleName = (id: string) =>
    moduleState.data?.modules.find((module) => module.id === id)?.name ??
    catalog.definition(id)?.name ??
    id;
  const businessPermissions = [
    ...new Set(
      moduleState.data?.permissionCatalog?.map((entry) => entry.permission) ??
        moduleState.data?.modules.flatMap((m) => m.permissions) ??
        productBusinessPermissions,
    ),
  ].filter((p) => !(PLATFORM_PERMISSIONS as readonly string[]).includes(p));
  const { client, scope, bootstrap, onError } = props,
    params = { workspaceId: scope.workspaceId },
    qc = useQueryClient();
  const [tab, setTab] = useState("members"),
    [invite, setInvite] = useState(false),
    [member, setMember] = useState<Member | null>(null),
    [role, setRole] = useState<Role | "new" | null>(null),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const memberAttempt = useRef<string | undefined>(undefined);
  const roleNameInput = useRef<HTMLInputElement>(null);
  const restoreRoleFocus = useRef(false);
  useEffect(() => {
    if (!busy && restoreRoleFocus.current) {
      restoreRoleFocus.current = false;
      roleNameInput.current?.focus();
    }
  }, [busy]);
  const roleConflict =
    error instanceof ApiError && error.code === "ROLE_CHANGED";
  const firstMemberRole = useRef<HTMLSpanElement>(null);
  const memberConflict =
    error instanceof ApiError && error.code === "MEMBER_CHANGED";
  const changeMember = (value: Member) => {
    setMember(value);
    memberAttempt.current = undefined;
  };
  const [search, setSearch] = useState("");
  const [pageCursors, setPageCursors] = useState<(string | undefined)[]>([
    undefined,
  ]);
  const pageCursor = pageCursors[pageCursors.length - 1];
  const changeSearch = (value: string) => {
    setSearch(value);
    setPageCursors([undefined]);
  };
  const [email, setEmail] = useState(""),
    [roleId, setRoleId] = useState(""),
    [roleName, setRoleName] = useState(""),
    [permissions, setPermissions] = useState<string[]>([]),
    [attempt, setAttempt] = useState<string>();
  const members = useQuery({
    queryKey: [
      scope.userId,
      scope.workspaceId,
      "members",
      tab === "members" ? pageCursor : undefined,
      tab === "members" ? search.trim() : "",
    ],
    queryFn: ({ signal }) =>
      client.request(
        {
          operation: "members",
          params,
          query: {
            cursor: tab === "members" ? pageCursor : undefined,
            limit: 20,
            search: tab === "members" ? search.trim() : "",
          },
        },
        { signal },
      ),
  });
  const roles = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "roles"],
    queryFn: () => client.request({ operation: "roles", params }),
  });
  const invitations = useQuery({
    queryKey: [
      scope.userId,
      scope.workspaceId,
      "invitations",
      tab === "invitations" ? pageCursor : undefined,
      tab === "invitations" ? search.trim() : "",
    ],
    queryFn: ({ signal }) =>
      client.request(
        {
          operation: "invitations",
          params,
          query: {
            cursor: tab === "invitations" ? pageCursor : undefined,
            limit: 20,
            search: tab === "invitations" ? search.trim() : "",
          },
        },
        { signal },
      ),
  });
  const refresh = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === scope.userId && q.queryKey[1] === scope.workspaceId,
    });
  async function act(
    fn: () => Promise<unknown>,
    close?: () => void,
    uncertainMessage?: string,
  ) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      close?.();
      // Completion is the accepted mutation; background reads must not keep
      // unrelated dialogs locked while their queries are refreshed.
      void refresh();
    } catch (cause) {
      const e =
        uncertainMessage && !(cause instanceof ApiError)
          ? new Error(uncertainMessage)
          : cause;
      setError(e);
      if (!(
        e instanceof ApiError &&
        ["MEMBER_CHANGED", "ROLE_CHANGED"].includes(e.code)
      ))
        onError(e);
    } finally {
      setBusy(false);
    }
  }
  const availableRoles = (roles.data ?? []).filter(
    (r) => r.name !== "Owner" || bootstrap.roleNames.includes("Owner"),
  );
  const needle = search.trim().toLowerCase();
  const filteredMembers = members.data?.items ?? [];
  const filteredInvitations = invitations.data?.items ?? [];
  const filteredRoles = (roles.data ?? []).filter((r) =>
    r.name.toLowerCase().includes(needle),
  );
  const viewCounts: Record<string, number | undefined> = {
    members: members.data?.workspaceTotal,
    invitations: invitations.data?.workspaceTotal,
    roles: roles.data?.length,
  };
  const isPending =
    tab === "members"
      ? members.isPending
      : tab === "roles"
        ? roles.isPending
        : invitations.isPending;
  const visibleCount =
    tab === "members"
      ? filteredMembers.length
      : tab === "roles"
        ? filteredRoles.length
        : filteredInvitations.length;
  const paginated = tab !== "roles";
  const pageQuery = tab === "members" ? members : invitations;
  const memberCount = members.isError ? undefined : members.data?.activeTotal;
  const readError =
    pageQuery.error instanceof ApiError
      ? pageQuery.error
      : pageQuery.error
        ? new Error(
            `The ${tab === "members" ? "member" : "invitation"} page could not be loaded. Check your connection and try again.`,
          )
        : undefined;
  return (
    <ListPage className="people-page">
      <PageHeading
        title="People & access"
        description="Your team, their tools, and what they can do."
        actions={
          bootstrap.workspace.kind === "company" && (
            <Button
              variant="primary"
              onClick={() => {
                setInvite(true);
                setEmail("");
                setRoleId(
                  roles.data?.find((r) => r.name === "Viewer")?.id ?? "",
                );
                setAttempt(crypto.randomUUID());
                setError(undefined);
              }}
            >
              <UserPlus size={17} />
              Invite a member
            </Button>
          )
        }
      />
      <div className="list-tabs">
        <SegmentedControl
          panelId="people-results"
          label="People views"
          value={tab}
          onChange={(value) => {
            setTab(value);
            changeSearch("");
          }}
          options={["members", "invitations", "roles"].map((value) => ({
            value,
            label: (
              <>
                {value.charAt(0).toUpperCase() + value.slice(1)}
                {viewCounts[value] !== undefined && (
                  <span className="tab-count" aria-hidden="true">
                    {viewCounts[value]}
                  </span>
                )}
              </>
            ),
          }))}
        />
      </div>
      <SummaryStrip
        className="people-summary"
        aria-label="Workspace access summary"
      >
        <div className="people-seat-meter">
          <h2>Workspace seats</h2>
          <strong className="summary-value">
            {memberCount ?? "—"}
            <small> / {bootstrap.seatLimit} used</small>
          </strong>
          <div
            className="summary-track"
            role="img"
            aria-label={
              memberCount === undefined
                ? "Workspace seat usage unavailable"
                : `${memberCount} of ${bootstrap.seatLimit} seats used`
            }
          >
            <span
              style={{
                width: `${Math.min(100, memberCount !== undefined && bootstrap.seatLimit > 0 ? (memberCount / bootstrap.seatLimit) * 100 : 0)}%`,
              }}
            />
          </div>
          <span className="summary-caption">
            {memberCount === undefined
              ? "Seat usage unavailable"
              : `${Math.max(0, bootstrap.seatLimit - memberCount)} seats available`}
          </span>
        </div>
        <div>
          <h2>Pending invitations</h2>
          <button
            className="summary-link"
            onClick={() => {
              setTab("invitations");
              changeSearch("");
            }}
            aria-label="View invitations"
          >
            <strong className="summary-value">
              {invitations.data ? invitations.data.pendingTotal : "—"}
            </strong>
            <ArrowRight size={16} />
          </button>
          <span className="summary-caption">
            A seat is used when someone joins. Pending invitations do not use a
            seat.
          </span>
        </div>
      </SummaryStrip>
      <ListToolbar>
        <SearchField
          value={search}
          onChange={changeSearch}
          placeholder={
            tab === "members"
              ? "Search members"
              : tab === "invitations"
                ? "Search invitations"
                : "Search roles"
          }
        />
        {tab === "roles" ? (
          <Button
            onClick={() => {
              setRole("new");
              setRoleName("");
              setPermissions([]);
              setAttempt(crypto.randomUUID());
              setError(undefined);
            }}
          >
            <Plus size={16} />
            Create role
          </Button>
        ) : (
          <span className="list-toolbar-note">
            {tab === "members"
              ? "Roles and module access"
              : "Invitations expire after 7 days"}
          </span>
        )}
      </ListToolbar>
      <ErrorMessage
        error={
          !invite && !member && !role
            ? (error ?? roles.error ?? (paginated ? readError : undefined))
            : undefined
        }
      />
      <ResultsMotion
        motionKey={`${tab}:${search}`}
        pending={isPending}
        id="people-results"
        role="tabpanel"
        aria-label="People and access"
        tabIndex={0}
      >
        {isPending ? (
          <ContentSkeleton label={`Loading ${tab}`} />
        ) : tab === "members" ? (
          members.isError ? null : filteredMembers.length ? (
            <ListTable className="people-table" aria-label="Members">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Roles</th>
                  <th>Module access</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Manage</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <RecordIdentity
                        symbol={m.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase()}
                        primary={m.name}
                        secondary={m.email}
                      />
                    </td>
                    <td>
                      <div className="people-role-names">
                        {m.roles.map((r) => (
                          <span key={r.id}>{r.name}</span>
                        ))}
                      </div>
                    </td>
                    <td className="people-modules">
                      {m.modules.map((id) => moduleName(id)).join(", ") ||
                        "No modules assigned"}
                    </td>
                    <td>
                      <Status status={m.active ? "active" : "removed"} />
                    </td>
                    <td className="row-actions">
                      <Button
                        variant="ghost"
                        aria-label={`Manage ${m.name}`}
                        disabled={
                          m.roles.some((r) => r.name === "Owner") &&
                          !bootstrap.roleNames.includes("Owner")
                        }
                        onClick={() => {
                          changeMember(m);
                          setError(undefined);
                        }}
                      >
                        Manage <ArrowRight size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ListTable>
          ) : (
            <Empty
              title={search ? "No matching members" : "No members yet"}
              description={
                search
                  ? "Try another name, email address, or role."
                  : "Members will appear here after joining the workspace."
              }
            />
          )
        ) : tab === "invitations" ? (
          invitations.isError ? null : filteredInvitations.length ? (
            <ListTable className="people-table" aria-label="Invitations">
              <thead>
                <tr>
                  <th>Invitee</th>
                  <th>Initial role</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredInvitations.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <RecordIdentity
                        symbol={<UserPlus size={16} />}
                        primary={i.email}
                      />
                    </td>
                    <td>
                      {i.roleName ??
                        roles.data?.find((r) => r.id === i.roleId)?.name ??
                        "Role unavailable"}
                    </td>
                    <td>
                      <Status status={i.state} />
                    </td>
                    <td className="muted">
                      {new Date(i.expiresAt).toLocaleDateString("en", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="row-actions">
                      {i.state === "pending" && (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          aria-label={`Revoke invitation for ${i.email}`}
                          onClick={() =>
                            void act(
                              () =>
                                client.request({
                                  operation: "inviteRevoke",
                                  params: { ...params, id: i.id },
                                }),
                              undefined,
                              "Revocation could not be confirmed. Retry to check its saved result.",
                            )
                          }
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ListTable>
          ) : (
            <Empty
              title={search ? "No matching invitations" : "No invitations yet"}
              description={
                search
                  ? "Try another email address."
                  : "Invite a teammate by their verified email address."
              }
            />
          )
        ) : filteredRoles.length ? (
          <ListTable className="people-table" aria-label="Roles">
            <thead>
              <tr>
                <th>Role</th>
                <th>Allowed actions</th>
                <th>Members</th>
                <th>Type</th>
                <th>
                  <span className="sr-only">Permissions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRoles.map((r) => (
                <tr key={r.id}>
                  <td>
                    <RecordIdentity
                      symbol={<Shield size={16} />}
                      primary={r.name}
                      secondary={
                        r.protected ? "Built-in role" : "Custom business role"
                      }
                    />
                  </td>
                  <td>{r.permissions.length} actions</td>
                  <td>
                    {members.data ? (members.data.roleCounts[r.id] ?? 0) : "—"}
                  </td>
                  <td className="role-kind">
                    {r.protected ? "Protected" : "Editable"}
                  </td>
                  <td className="row-actions">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRole(r);
                        setAttempt(crypto.randomUUID());
                        setRoleName(r.name);
                        setPermissions(r.permissions);
                        setError(undefined);
                      }}
                    >
                      {r.protected ? "View permissions" : "Edit permissions"}
                      <ArrowRight size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </ListTable>
        ) : (
          <Empty
            title={search ? "No matching roles" : "No roles yet"}
            description={
              search
                ? "Try another role name."
                : "Create a role to define the actions your team can perform."
            }
          />
        )}
      </ResultsMotion>
      {(!isPending || paginated) && (
        <div className="list-footer" aria-live="polite">
          {paginated && isPending ? (
            <span>Loading {tab}…</span>
          ) : paginated && pageQuery.isError ? (
            <>
              <span>
                {tab === "members" ? "Members" : "Invitations"} could not be
                loaded.
              </span>
              <Button
                disabled={pageQuery.isFetching}
                onClick={() => void pageQuery.refetch()}
              >
                Try again
              </Button>
              {pageCursors.length > 1 && (
                <Button onClick={() => setPageCursors([undefined])}>
                  Return to first page
                </Button>
              )}
            </>
          ) : (
            <span>
              {visibleCount}
              {paginated &&
              pageQuery.data &&
              pageQuery.data.total !== visibleCount
                ? ` of ${pageQuery.data.total}`
                : ""}{" "}
              {(paginated ? pageQuery.data?.total : visibleCount) === 1
                ? tab === "members"
                  ? "member"
                  : tab === "roles"
                    ? "role"
                    : "invitation"
                : tab}{" "}
              {search ? "matching your search" : "in this workspace"}
            </span>
          )}
          {paginated &&
            (pageCursors.length > 1 || pageQuery.data?.nextCursor) && (
              <Pagination
                pending={pageQuery.isFetching || busy}
                next={pageQuery.data?.nextCursor}
                hasPrevious={pageCursors.length > 1}
                onNext={() => {
                  if (pageQuery.data?.nextCursor)
                    setPageCursors([...pageCursors, pageQuery.data.nextCursor]);
                }}
                onPrevious={() => setPageCursors(pageCursors.slice(0, -1))}
              />
            )}
          {search && (
            <Button variant="ghost" onClick={() => changeSearch("")}>
              Clear search
            </Button>
          )}
        </div>
      )}
      <Modal
        className="people-dialog"
        open={invite}
        onOpenChange={(o) => !busy && setInvite(o)}
        title="Invite a teammate"
        description="They can accept after signing in with this verified email address. Invitations expire in seven days."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                client.request({
                  operation: "inviteCreate",
                  params,
                  body: { email, roleId },
                  idempotencyKey: attempt,
                }),
              () => {
                setInvite(false);
                setTab("invitations");
                changeSearch("");
              },
              "Invitation creation could not be confirmed. Retry without changing the details to check its saved result.",
            );
          }}
          className="form-stack"
        >
          <Field label="Email address">
            <Input
              type="email"
              disabled={busy}
              required
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setAttempt(crypto.randomUUID());
              }}
            />
          </Field>
          <Field label="Initial role">
            <Select
              disabled={busy}
              required
              value={roleId}
              onValueChange={(e) => {
                setRoleId(e);
                setAttempt(crypto.randomUUID());
              }}
            >
              <SelectOption value="">Choose role</SelectOption>
              {availableRoles.map((r) => (
                <SelectOption key={r.id} value={r.id}>
                  {r.name}
                </SelectOption>
              ))}
            </Select>
          </Field>
          <div className="notice">
            Module access is assigned separately after the invitation is
            accepted. The invitation appears when the recipient signs in.
          </div>
          <ErrorMessage error={error} />
          <div className="form-footer">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Creating…" : "Create invitation"}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        className="people-dialog"
        open={!!member}
        onOpenChange={(o) => !busy && !o && setMember(null)}
        title={member ? `Manage ${member.name}` : "Manage member"}
        description="Roles define allowed actions. Module assignments define the tools this member can use."
      >
        {member && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const key = memberAttempt.current ?? crypto.randomUUID();
              memberAttempt.current = key;
              void act(
                () =>
                  client.request({
                    operation: "memberEdit",
                    params: { ...params, id: member.id },
                    idempotencyKey: key,
                    body: {
                      revision: member.revision,
                      active: member.active,
                      roleIds: member.roles.map((r) => r.id),
                      modules: member.modules,
                      directModules: member.directModules ?? member.modules,
                    },
                  }),
                () => setMember(null),
              );
            }}
          >
            <fieldset>
              <legend>Roles</legend>
              {availableRoles.map((r, index) => (
                <label key={r.id} className="check-row">
                  <Checkbox
                    ref={index === 0 ? firstMemberRole : undefined}
                    disabled={busy}
                    checked={member.roles.some((m) => m.id === r.id)}
                    onCheckedChange={(e) =>
                      changeMember({
                        ...member,
                        roles: e
                          ? [...member.roles, r]
                          : member.roles.filter((m) => m.id !== r.id),
                      })
                    }
                  />
                  {r.name}
                </label>
              ))}
            </fieldset>
            {!!member.modulePolicies?.length && (
              <section aria-label="Role module policies">
                <h3>Role module policies</h3>
                <p>
                  Saved policy access is recalculated when role changes are
                  saved.
                </p>
                <ul>
                  {member.modulePolicies.map((policy) => (
                    <li key={policy.moduleId}>
                      {moduleName(policy.moduleId)}:{" "}
                      {policy.assigned ? "Assigned" : "Awaiting availability"}.{" "}
                      {policy.sources.join(", ")}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <fieldset>
              <legend>Direct module assignments</legend>
              <p>
                These grants are independent of role policies. Removing a direct
                grant preserves access supplied by a group or tag.
              </p>
              {moduleState.data?.modules.map((module) => {
                const activation = bootstrap.modules.find(
                  (m) => m.moduleId === module.id,
                );
                const ready =
                  activation?.entitled && activation.state === "enabled";
                const dependencies = Object.keys(module.dependencies).map(
                  (id) =>
                    moduleState.data?.modules.find((m) => m.id === id)?.name ??
                    id,
                );
                return (
                  <label key={module.id} className="check-row">
                    <Checkbox
                      checked={(
                        member.directModules ?? member.modules
                      ).includes(module.id)}
                      disabled={
                        busy ||
                        (!ready &&
                          !(member.directModules ?? member.modules).includes(
                            module.id,
                          ))
                      }
                      onCheckedChange={(checked) =>
                        changeMember({
                          ...member,
                          directModules: checked
                            ? [
                                ...(member.directModules ?? member.modules),
                                module.id,
                              ]
                            : (member.directModules ?? member.modules).filter(
                                (id) => id !== module.id,
                              ),
                        })
                      }
                    />
                    <span>
                      {module.name}
                      {dependencies.length
                        ? ` (includes ${dependencies.join(", ")})`
                        : ""}
                      {!ready && (
                        <span className="small muted">
                          : requires an enabled license and publication
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
              <ErrorMessage error={moduleState.error} />
            </fieldset>
            <label className="check-row">
              <Checkbox
                disabled={busy}
                checked={member.active}
                onCheckedChange={(e) => changeMember({ ...member, active: e })}
              />
              Active membership
            </label>
            <ErrorMessage error={memberConflict ? undefined : error} />
            {memberConflict && (
              <section aria-label="Changed member access" className="notice">
                <p role="alert">
                  This member’s access changed. Your unsaved choices are still
                  shown. Reload replaces them with current access for review.
                </p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const latest = await client.request({
                        operation: "member",
                        params: { ...params, id: member.id },
                      });
                      changeMember(latest);
                      requestAnimationFrame(() =>
                        firstMemberRole.current?.focus(),
                      );
                    })
                  }
                >
                  Reload current access
                </Button>
              </section>
            )}
            <div className="form-footer">
              <Button
                variant="primary"
                type="submit"
                disabled={busy || memberConflict}
              >
                Save access
              </Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        className="people-dialog"
        open={!!role}
        onOpenChange={(o) => !busy && !o && setRole(null)}
        title={
          role === "new" ? "Create business role" : `Role: ${role?.name ?? ""}`
        }
        description="Select the actions members with this role can perform."
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              busy ||
              roleConflict ||
              !role ||
              (role !== "new" && role.protected)
            )
              return;
            void act(
              () =>
                role === "new"
                  ? client.request({
                      operation: "roleCreate",
                      params,
                      body: { name: roleName, permissions },
                      idempotencyKey: attempt,
                    })
                  : client.request({
                      operation: "roleEdit",
                      params: { ...params, id: role.id },
                      body: {
                        name: roleName,
                        permissions,
                        revision: role.revision,
                      },
                      idempotencyKey: attempt,
                    }),
              () => setRole(null),
              "The role update could not be confirmed. Retry without changing your choices to check its saved result.",
            );
          }}
        >
          <Field label="Role name">
            <Input
              ref={roleNameInput}
              required
              maxLength={60}
              value={roleName}
              disabled={busy || (role !== "new" && !!role?.protected)}
              onChange={(e) => {
                setRoleName(e.target.value);
                setAttempt(crypto.randomUUID());
              }}
            />
          </Field>
          <fieldset className="permission-list">
            <legend>Allowed actions</legend>
            <p>
              Actions from other releases may allow saved-work recovery and
              supported older clients. Current permissions and module access
              still apply.
            </p>
            {(role !== "new" && role?.protected
              ? role.permissions
              : businessPermissions
            ).map((p) => (
              <div key={p}>
                <label className="check-row">
                  <Checkbox
                    aria-describedby={
                      moduleState.data?.permissionCatalog?.some(
                        (entry) => entry.permission === p && !entry.current,
                      ) &&
                      !moduleState.data?.permissionCatalog?.some(
                        (entry) => entry.permission === p && entry.current,
                      )
                        ? `permission-origin-${p}`
                        : undefined
                    }
                    checked={permissions.includes(p)}
                    disabled={busy || (role !== "new" && !!role?.protected)}
                    onCheckedChange={(e) => {
                      setPermissions(
                        e
                          ? [...permissions, p]
                          : permissions.filter((x) => x !== p),
                      );
                      setAttempt(crypto.randomUUID());
                    }}
                  />
                  <span>{permissionLabel(p)}</span>
                </label>
                <PermissionOrigin
                  id={`permission-origin-${p}`}
                  entries={moduleState.data?.permissionCatalog?.filter(
                    (entry) => entry.permission === p,
                  )}
                />
              </div>
            ))}
          </fieldset>
          <ErrorMessage error={roleConflict ? undefined : error} />
          {roleConflict && role && role !== "new" && (
            <section aria-label="Changed role permissions" className="notice">
              <p role="alert">
                This role changed. Your unsaved choices are still shown. Reload
                replaces them with current permissions for review.
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const current = await client.request({
                      operation: "roles",
                      params,
                    });
                    const latest = current.find((item) => item.id === role.id);
                    if (!latest)
                      throw new Error("This role is no longer available.");
                    setRole(latest);
                    setRoleName(latest.name);
                    setPermissions(latest.permissions);
                    setAttempt(crypto.randomUUID());
                    restoreRoleFocus.current = true;
                  })
                }
              >
                Reload current permissions
              </Button>
            </section>
          )}
          {(role === "new" || !role?.protected) && (
            <div className="form-footer">
              <Button
                variant="primary"
                disabled={
                  busy ||
                  roleConflict ||
                  moduleState.isPending ||
                  !!moduleState.error
                }
                type="submit"
              >
                Save role
              </Button>
            </div>
          )}
        </form>
      </Modal>
    </ListPage>
  );
}
