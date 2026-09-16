import { Table } from "@suite/ui-web";
import { ModuleLifecycle, Appearance } from "./platform-admin";
import { moduleDefinition } from "@suite/module-catalog";
import {
  useToast,
  Input,
  Select,
  SelectOption,
  Checkbox,
  Textarea,
} from "@suite/ui-web";
import { useState, type ReactNode } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  UserPlus,
  Plus,
  Shield,
  Package,
  ShoppingBag,
  ArrowRight,
  Check,
  Ban,
  Bell,
  Download,
} from "@suite/ui-web/icons";
import {
  Button,
  Modal,
  Field,
  ErrorMessage,
  PageHeading,
  Status,
  Badge,
  Empty,
  Loading,
  Pagination,
  ResultsMotion,
  ContentSkeleton,
  SegmentedControl,
  SearchField,
  ListPage,
  ListToolbar,
  ListTable,
  SummaryStrip,
  RecordIdentity,
} from "@suite/ui-web";
import { type FeatureProps } from "@suite/platform";
import {
  BUSINESS_PERMISSIONS,
  type Static,
  type Permission,
  type MemberSchema,
  type RoleSchema,
} from "@suite/contracts";
type Member = Static<typeof MemberSchema>;
type Role = Static<typeof RoleSchema>;
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
  const { client, scope, bootstrap, onError } = props,
    params = { workspaceId: scope.workspaceId },
    qc = useQueryClient();
  const [tab, setTab] = useState("members"),
    [invite, setInvite] = useState(false),
    [member, setMember] = useState<Member | null>(null),
    [role, setRole] = useState<Role | "new" | null>(null),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [email, setEmail] = useState(""),
    [roleId, setRoleId] = useState(""),
    [roleName, setRoleName] = useState(""),
    [permissions, setPermissions] = useState<string[]>([]),
    [attempt, setAttempt] = useState<string>();
  const members = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "members"],
    queryFn: () => client.request({ operation: "members", params }),
  });
  const roles = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "roles"],
    queryFn: () => client.request({ operation: "roles", params }),
  });
  const invitations = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "invitations"],
    queryFn: () => client.request({ operation: "invitations", params }),
  });
  const refresh = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === scope.userId && q.queryKey[1] === scope.workspaceId,
    });
  async function act(fn: () => Promise<unknown>, close?: () => void) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      close?.();
      await refresh();
    } catch (e) {
      setError(e);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  const availableRoles = (roles.data ?? []).filter(
    (r) => r.name !== "Owner" || bootstrap.roleNames.includes("Owner"),
  );
  const needle = search.trim().toLowerCase();
  const filteredMembers = (members.data ?? []).filter((m) =>
    `${m.name} ${m.email} ${m.roles.map((r) => r.name).join(" ")}`
      .toLowerCase()
      .includes(needle),
  );
  const filteredInvitations = (invitations.data ?? []).filter((i) =>
    i.email.toLowerCase().includes(needle),
  );
  const filteredRoles = (roles.data ?? []).filter((r) =>
    r.name.toLowerCase().includes(needle),
  );
  const viewCounts: Record<string, number | undefined> = {
    members: members.data?.length,
    invitations: invitations.data?.length,
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
            setSearch("");
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
            {bootstrap.memberCount}
            <small> / {bootstrap.seatLimit} used</small>
          </strong>
          <div
            className="summary-track"
            role="img"
            aria-label={`${bootstrap.memberCount} of ${bootstrap.seatLimit} seats used`}
          >
            <span
              style={{
                width: `${Math.min(100, bootstrap.seatLimit > 0 ? (bootstrap.memberCount / bootstrap.seatLimit) * 100 : 0)}%`,
              }}
            />
          </div>
          <span className="summary-caption">
            {Math.max(0, bootstrap.seatLimit - bootstrap.memberCount)} seats
            available
          </span>
        </div>
        <div>
          <h2>Pending invitations</h2>
          <button
            className="summary-link"
            onClick={() => {
              setTab("invitations");
              setSearch("");
            }}
            aria-label="View invitations"
          >
            <strong className="summary-value">
              {invitations.data
                ? invitations.data.filter((i) => i.state === "pending").length
                : "—"}
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
          onChange={setSearch}
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
            ? (error ?? members.error ?? roles.error ?? invitations.error)
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
          filteredMembers.length ? (
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
                      {m.modules
                        .map((id) => moduleDefinition(id)?.name ?? id)
                        .join(", ") || "No modules assigned"}
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
                          setMember(m);
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
          filteredInvitations.length ? (
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
                      {roles.data?.find((r) => r.id === i.roleId)?.name ??
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
                            void act(() =>
                              client.request({
                                operation: "inviteRevoke",
                                params: { ...params, id: i.id },
                              }),
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
                    {members.data
                      ? members.data.filter(
                          (m) =>
                            m.active &&
                            m.roles.some((role) => role.id === r.id),
                        ).length
                      : "—"}
                  </td>
                  <td className="role-kind">
                    {r.protected ? "Protected" : "Editable"}
                  </td>
                  <td className="row-actions">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setRole(r);
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
      {!isPending && (
        <div className="list-footer" aria-live="polite">
          <span>
            {visibleCount}{" "}
            {visibleCount === 1
              ? tab === "members"
                ? "member"
                : tab === "roles"
                  ? "role"
                  : "invitation"
              : tab}{" "}
            {search ? "matching your search" : "in this workspace"}
          </span>
          {search && (
            <Button variant="ghost" onClick={() => setSearch("")}>
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
              () => setInvite(false),
            );
          }}
          className="form-stack"
        >
          <Field label="Email address">
            <Input
              type="email"
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
              void act(
                () =>
                  client.request({
                    operation: "memberEdit",
                    params: { ...params, id: member.id },
                    body: {
                      active: member.active,
                      roleIds: member.roles.map((r) => r.id),
                      modules: member.modules,
                    },
                  }),
                () => setMember(null),
              );
            }}
          >
            <fieldset>
              <legend>Roles</legend>
              {availableRoles.map((r) => (
                <label key={r.id} className="check-row">
                  <Checkbox
                    checked={member.roles.some((m) => m.id === r.id)}
                    onCheckedChange={(e) =>
                      setMember({
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
            <fieldset>
              <legend>Module assignments</legend>
              {["inventory", "orders"].map((id) => (
                <label key={id} className="check-row">
                  <Checkbox
                    checked={member.modules.includes(id)}
                    onCheckedChange={(e) =>
                      setMember({
                        ...member,
                        modules: e
                          ? [...member.modules, id]
                          : member.modules.filter((m) => m !== id),
                      })
                    }
                  />
                  {id === "orders"
                    ? "Orders (includes Inventory)"
                    : "Inventory"}
                </label>
              ))}
            </fieldset>
            <label className="check-row">
              <Checkbox
                checked={member.active}
                onCheckedChange={(e) => setMember({ ...member, active: e })}
              />
              Active membership
            </label>
            <ErrorMessage error={error} />
            <div className="form-footer">
              <Button variant="primary" type="submit" disabled={busy}>
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
                      params: { ...params, id: (role as Role).id },
                      body: { name: roleName, permissions },
                    }),
              () => setRole(null),
            );
          }}
        >
          <Field label="Role name">
            <Input
              required
              maxLength={60}
              value={roleName}
              disabled={role !== "new" && !!role?.protected}
              onChange={(e) => {
                setRoleName(e.target.value);
                setAttempt(crypto.randomUUID());
              }}
            />
          </Field>
          <fieldset className="permission-list">
            <legend>Allowed actions</legend>
            {(role !== "new" && role?.protected
              ? role.permissions
              : BUSINESS_PERMISSIONS
            ).map((p) => (
              <label className="check-row" key={p}>
                <Checkbox
                  checked={permissions.includes(p)}
                  disabled={role !== "new" && !!role?.protected}
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
            ))}
          </fieldset>
          <ErrorMessage error={error} />
          {(role === "new" || !role?.protected) && (
            <div className="form-footer">
              <Button variant="primary" disabled={busy} type="submit">
                Save role
              </Button>
            </div>
          )}
        </form>
      </Modal>
    </ListPage>
  );
}
export function Modules(props: FeatureProps) {
  const { client, scope, bootstrap, onError } = props;
  const params = { workspaceId: scope.workspaceId },
    qc = useQueryClient(),
    admin = bootstrap.permissions.includes("modules.manage");
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<BootstrapModule | null>(null),
    [reason, setReason] = useState(""),
    [requesting, setRequesting] = useState<string>();
  type BootstrapModule = (typeof bootstrap.modules)[number];
  const requests = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "accessRequests"],
    queryFn: () => client.request({ operation: "accessRequests", params }),
  });
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === scope.userId && q.queryKey[1] === scope.workspaceId,
      });
      setEditing(null);
      setRequesting(undefined);
    } catch (e) {
      setError(e);
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Modules"
        description="Configure modules and manage access requests."
      />
      <ModuleLifecycle
        {...props}
        renderAccess={(moduleId) => {
          const m = bootstrap.modules.find((m) => m.moduleId === moduleId);
          if (!m) return null;
          return (
            <div className="module-toolbar">
              {admin ? (
                <Button
                  onClick={() => {
                    setEditing(m);
                    setError(undefined);
                  }}
                >
                  Configure access
                  <ArrowRight size={15} />
                </Button>
              ) : m.assigned ? (
                <span className="small muted">
                  Available with your role’s permissions
                </span>
              ) : m.accessPolicy === "admin" ? (
                <span className="small muted">
                  An administrator assigns access
                </span>
              ) : (
                <Button
                  disabled={
                    m.state !== "enabled" ||
                    !m.entitled ||
                    requests.data?.some(
                      (r) => r.moduleId === m.moduleId && r.state === "pending",
                    )
                  }
                  onClick={() => {
                    setRequesting(m.moduleId);
                    setReason("");
                  }}
                >
                  {requests.data?.some(
                    (r) => r.moduleId === m.moduleId && r.state === "pending",
                  )
                    ? "Pending approval"
                    : m.accessPolicy === "self"
                      ? "Get access"
                      : "Request access"}
                </Button>
              )}
            </div>
          );
        }}
      />
      <ErrorMessage
        error={!editing && !requesting ? (error ?? requests.error) : undefined}
      />
      <h2 className="section-heading">
        {admin ? "Access requests" : "Your requests"}
      </h2>
      {requests.data?.length ? (
        <div className="table-wrap">
          <Table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Module</th>
                <th>Reason</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Resolve request</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {requests.data.map((r) => (
                <tr key={r.id}>
                  <td>{r.memberName}</td>
                  <td>{r.moduleId}</td>
                  <td className="muted">{r.reason || "No reason provided"}</td>
                  <td>
                    <Status status={r.state} />
                  </td>
                  <td>
                    {r.state === "pending" && (
                      <div className="actions">
                        {admin ? (
                          <>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void act(() =>
                                  client.request({
                                    operation: "accessResolve",
                                    params: { ...params, id: r.id },
                                    body: { state: "approved" },
                                  }),
                                )
                              }
                            >
                              Approve
                            </Button>
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void act(() =>
                                  client.request({
                                    operation: "accessResolve",
                                    params: { ...params, id: r.id },
                                    body: { state: "denied" },
                                  }),
                                )
                              }
                            >
                              Deny
                            </Button>
                          </>
                        ) : (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                client.request({
                                  operation: "accessResolve",
                                  params: { ...params, id: r.id },
                                  body: { state: "cancelled" },
                                }),
                              )
                            }
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : (
        <Empty
          title="No access requests"
          description="Module requests and their decisions will appear here."
        />
      )}
      <Modal
        open={!!editing}
        onOpenChange={(o) => !busy && !o && setEditing(null)}
        title={`Configure ${editing?.moduleId ?? "module"}`}
        description="Suspension stops new operations and preserves existing business records."
      >
        {editing && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() =>
                client.request({
                  operation: "moduleEdit",
                  params: { ...params, moduleId: editing.moduleId },
                  body: {
                    state: editing.state,
                    accessPolicy: editing.accessPolicy,
                  },
                }),
              );
            }}
          >
            <Field label="Module state">
              <Select
                value={editing.state}
                onValueChange={(e) =>
                  setEditing({
                    ...editing,
                    state: e as typeof editing.state,
                  })
                }
              >
                <SelectOption value="draft">Draft</SelectOption>
                <SelectOption value="enabled">Enabled</SelectOption>
                <SelectOption value="suspended">Suspended</SelectOption>
              </Select>
            </Field>
            <Field label="Access policy">
              <Select
                value={editing.accessPolicy}
                onValueChange={(e) =>
                  setEditing({
                    ...editing,
                    accessPolicy: e as typeof editing.accessPolicy,
                  })
                }
              >
                <SelectOption value="admin">
                  Administrator assignment
                </SelectOption>
                <SelectOption value="approval">Require approval</SelectOption>
                <SelectOption value="self">Self-service access</SelectOption>
              </Select>
            </Field>
            {editing.moduleId === "inventory" && (
              <div className="notice">
                Suspending Inventory also blocks order operations. Reservations
                remain recorded until Inventory is enabled again.
              </div>
            )}
            <ErrorMessage error={error} />
            <div className="form-footer">
              <Button variant="primary" type="submit" disabled={busy}>
                Save configuration
              </Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={!!requesting}
        onOpenChange={(o) => !busy && !o && setRequesting(undefined)}
        title="Request module access"
        description="Your role still determines which actions are available after access is granted."
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              client.request({
                operation: "accessRequest",
                params: { ...params, moduleId: requesting! },
                body: { reason },
                idempotencyKey: crypto.randomUUID(),
              }),
            );
          }}
        >
          <Field label="Reason (optional)">
            <Textarea
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <ErrorMessage error={error} />
          <div className="form-footer">
            <Button variant="primary" type="submit" disabled={busy}>
              Submit request
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
export function Audit({ client, scope }: FeatureProps) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const q = useQuery({
    placeholderData: keepPreviousData,
    queryKey: [scope.userId, scope.workspaceId, "audit", cursors.at(-1)],
    queryFn: () =>
      client.request({
        operation: "audit",
        params: { workspaceId: scope.workspaceId },
        query: { cursor: cursors.at(-1) },
      }),
  });
  return (
    <ListPage className="audit-page">
      <PageHeading
        title="Audit history"
        description="A record of changes to your workspace, stock, and access."
      />
      <ListToolbar>
        <span className="list-toolbar-note">Workspace activity</span>
        <Button disabled={q.isFetching} onClick={() => void q.refetch()}>
          {q.isFetching ? "Refreshing…" : "Refresh activity"}
        </Button>
      </ListToolbar>
      <ErrorMessage error={q.error} />
      <ResultsMotion
        motionKey={cursors.at(-1) ?? "first"}
        pending={q.isPlaceholderData || q.isLoading}
      >
        {q.isLoading ? (
          <ContentSkeleton label="Loading audit history" />
        ) : !q.data?.items.length ? (
          <Empty
            title={cursors.length > 1 ? "No more activity" : "No activity yet"}
            description={
              cursors.length > 1
                ? "Return to the previous page to review earlier results."
                : "Changes to this workspace will appear here."
            }
            action={
              cursors.length > 1 && (
                <Button onClick={() => setCursors(cursors.slice(0, -1))}>
                  Previous
                </Button>
              )
            }
          />
        ) : (
          <>
            <ListTable className="audit-table" aria-label="Audit events">
              <thead>
                <tr>
                  <th>Actor</th>
                  <th>Activity</th>
                  <th>Target</th>
                  <th>Outcome</th>
                  <th>Date and time</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <RecordIdentity
                        symbol={(a.actorName || "System")
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase()}
                        primary={a.actorName || "System"}
                      />
                    </td>
                    <td>
                      <RecordIdentity
                        primary={a.action
                          .split(/[._-]/)
                          .map((part, index) =>
                            index === 0
                              ? part.charAt(0).toUpperCase() + part.slice(1)
                              : part,
                          )
                          .join(" ")}
                        secondary={<span className="mono">{a.action}</span>}
                      />
                    </td>
                    <td>
                      <span className="mono audit-target">
                        {moduleDefinition(a.targetId)?.name ?? a.targetId}
                      </span>
                    </td>
                    <td>
                      <Status
                        status={a.outcome}
                        label={
                          a.outcome === "success" ? "Succeeded" : undefined
                        }
                      />
                    </td>
                    <td>
                      <time dateTime={a.createdAt}>
                        <span>
                          {new Date(a.createdAt).toLocaleDateString("en", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                        <span className="record-secondary">
                          {new Date(a.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ListTable>
            <div className="list-footer">
              <span>{q.data.items.length} events on this page</span>
              <Pagination
                pending={q.isPlaceholderData || q.isFetching}
                next={q.data.nextCursor}
                hasPrevious={cursors.length > 1}
                onNext={() =>
                  setCursors([...cursors, q.data?.nextCursor ?? undefined])
                }
                onPrevious={() => setCursors(cursors.slice(0, -1))}
              />
            </div>
          </>
        )}
      </ResultsMotion>
    </ListPage>
  );
}
export function Notifications({ client, scope, onError }: FeatureProps) {
  const params = { workspaceId: scope.workspaceId };
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  async function decide(id: string, state: "approved" | "denied") {
    setBusy(id);
    setError(undefined);
    try {
      await client.request({
        operation: "accessResolve",
        params: { ...params, id },
        body: { state },
        idempotencyKey: crypto.randomUUID(),
      });
      await qc.invalidateQueries({
        queryKey: [scope.userId, scope.workspaceId],
      });
    } catch (error) {
      setError(error);
      onError(error);
    } finally {
      setBusy(undefined);
    }
  }
  const q = useQuery({
    queryKey: [scope.userId, scope.workspaceId, "notifications"],
    queryFn: () => client.request({ operation: "notifications", params }),
    refetchInterval: 30000,
  });
  return (
    <>
      <PageHeading
        title="Notifications"
        description="Invitations, access decisions, and updates that need your attention."
      />
      <ErrorMessage error={error ?? q.error} />
      {q.isPending ? (
        <Loading label="Loading notifications" />
      ) : q.data?.length ? (
        <section className="panel">
          {q.data.map((n) => (
            <div className="list-row" key={n.id}>
              <Bell size={18} />
              <div className="grow">
                <strong>{n.title}</strong>
                <p>{n.message}</p>
                {n.action && (
                  <div>
                    <p>
                      {n.action.moduleId}:{" "}
                      {n.action.reason || "No reason provided"}
                    </p>
                    {n.action.state === "pending" ? (
                      <div className="actions">
                        <Button
                          disabled={!!busy}
                          onClick={() => void decide(n.action!.id, "approved")}
                        >
                          Approve access
                        </Button>
                        <Button
                          disabled={!!busy}
                          onClick={() => void decide(n.action!.id, "denied")}
                        >
                          Deny access
                        </Button>
                      </div>
                    ) : (
                      <Status status={n.action.state} />
                    )}
                  </div>
                )}
                <span className="small muted">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </div>
              {!n.read && (
                <Button
                  onClick={async () => {
                    try {
                      await client.request({
                        operation: "notificationRead",
                        params: { ...params, id: n.id },
                        body: {},
                        idempotencyKey: crypto.randomUUID(),
                      });
                      await q.refetch();
                    } catch (e) {
                      onError(e);
                    }
                  }}
                >
                  Mark read
                </Button>
              )}
            </div>
          ))}
        </section>
      ) : (
        <Empty
          title="No notifications"
          description="New workspace notifications will appear here."
        />
      )}
    </>
  );
}
export function Settings(
  props: FeatureProps & {
    toggleOffline: () => Promise<void>;
    theme: string;
    setTheme: (theme: string) => void;
    children?: ReactNode;
  },
) {
  const toast = useToast();
  const {
    client,
    scope,
    bootstrap,
    theme,
    setTheme,
    toggleOffline,
    offlineEnabled,
  } = props;
  const [name, setName] = useState(bootstrap.workspace.name),
    [hours, setHours] = useState(String(bootstrap.offlineHours)),
    [accent, setAccent] = useState(bootstrap.workspace.accent ?? "forest"),
    [logoDataUrl, setLogo] = useState(bootstrap.workspace.logoDataUrl ?? ""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  return (
    <>
      <PageHeading
        title="Settings"
        description="Appearance, offline access, and workspace preferences."
      />
      <div className="settings-grid">
        <section className="panel">
          <h2>Appearance</h2>
          <p>Your preferences stay with this browser or desktop application.</p>
          <Field label="Theme">
            <Select value={theme} onValueChange={(e) => setTheme(e)}>
              <SelectOption value="high-contrast">High contrast</SelectOption>
              <SelectOption value="system">Use system appearance</SelectOption>
              <SelectOption value="light">Light</SelectOption>
              <SelectOption value="dark">Dark</SelectOption>
            </Select>
          </Field>
        </section>
        <section className="panel">
          <h2>Offline work on this device</h2>
          <p>
            {bootstrap.offlineHours
              ? "Keep a limited cache and order drafts available for up to 24 hours after authorization."
              : "The workspace administrator has disabled offline storage."}
          </p>
          <Button
            disabled={!bootstrap.offlineHours || busy}
            onClick={async () => {
              try {
                await toggleOffline();
              } catch (e) {
                setError(e);
              }
            }}
          >
            {offlineEnabled
              ? "Disable offline storage"
              : "Enable on this device"}
          </Button>
          <p className="small settings-note">
            Local drafts are not a backup. Signing out removes local workspace
            data.
          </p>
        </section>
        {bootstrap.permissions.includes("workspace.manage") && (
          <section className="panel">
            <h2>Workspace policy</h2>
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(undefined);
                try {
                  await client.request({
                    operation: "workspaceEdit",
                    params: { workspaceId: scope.workspaceId },
                    body: { name, offlineHours: hours, accent, logoDataUrl },
                  });
                  await qc.invalidateQueries({
                    queryKey: [scope.userId, scope.workspaceId, "bootstrap"],
                  });
                  toast.add({
                    title: "Workspace policy saved.",
                    type: "success",
                  });
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Workspace name">
                <Input
                  required
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Workspace accent">
                <Select
                  value={accent}
                  onValueChange={(e) => setAccent(e as typeof accent)}
                >
                  <SelectOption value="forest">Forest</SelectOption>
                  <SelectOption value="blue">Blue</SelectOption>
                  <SelectOption value="plum">Plum</SelectOption>
                </Select>
              </Field>
              <Field label="Company logo" hint="PNG, up to 36 KB.">
                <Input
                  type="file"
                  accept="image/png"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 36000 || file.type !== "image/png") {
                      setError(new Error("Choose a PNG logo up to 36 KB."));
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => setLogo(String(reader.result));
                    reader.onerror = () =>
                      setError(new Error("The logo could not be read."));
                    reader.readAsDataURL(file);
                  }}
                />
              </Field>
              {!!logoDataUrl && (
                <Button type="button" onClick={() => setLogo("")}>
                  Remove logo
                </Button>
              )}
              <Field label="Company offline access">
                <Select value={hours} onValueChange={(e) => setHours(e)}>
                  <SelectOption value="0">Disabled</SelectOption>
                  <SelectOption value="24">
                    Allow a 24-hour offline window
                  </SelectOption>
                </Select>
              </Field>
              <Button type="submit" variant="primary" disabled={busy}>
                Save workspace policy
              </Button>
            </form>
          </section>
        )}
        {props.children}
      </div>
      <ErrorMessage error={error} />
    </>
  );
}
