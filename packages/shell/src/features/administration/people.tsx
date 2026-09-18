import { PermissionOrigin } from "./permission-origin";
import { type FeatureProps } from "@suite/client";
import {
  PLATFORM_PERMISSIONS,
  type MemberSchema,
  type Permission,
  type RoleSchema,
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
import { useState } from "react";
import { useShellComposition } from "../../app/composition";
import { usePlatformState } from "./platform-admin";
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
  const { catalog, businessPermissions: productBusinessPermissions } =
    useShellComposition();
  const moduleState = usePlatformState(props);
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
      // Completion is the accepted mutation; background reads must not keep
      // unrelated dialogs locked while their queries are refreshed.
      void refresh();
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
                        .map((id) => catalog.definition(id)?.name ?? id)
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
                      checked={member.modules.includes(module.id)}
                      disabled={!ready && !member.modules.includes(module.id)}
                      onCheckedChange={(checked) =>
                        setMember({
                          ...member,
                          modules: checked
                            ? [...member.modules, module.id]
                            : member.modules.filter((id) => id !== module.id),
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
                <PermissionOrigin
                  id={`permission-origin-${p}`}
                  entries={moduleState.data?.permissionCatalog?.filter(
                    (entry) => entry.permission === p,
                  )}
                />
              </div>
            ))}
          </fieldset>
          <ErrorMessage error={error} />
          {(role === "new" || !role?.protected) && (
            <div className="form-footer">
              <Button
                variant="primary"
                disabled={busy || moduleState.isPending || !!moduleState.error}
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
