import { createHash } from "node:crypto";

/** A precondition over editable access, including changes made outside the member editor. */
export function memberRevision(
  workspaceId: string,
  member: {
    id: string;
    userId: string;
    active: boolean;
    roleIds: readonly string[];
    directModules: readonly string[];
  },
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "member-access-v1",
        workspaceId,
        member.id,
        member.userId,
        member.active,
        [...member.roleIds].sort(),
        [...member.directModules].sort(),
      ]),
    )
    .digest("hex");
}
