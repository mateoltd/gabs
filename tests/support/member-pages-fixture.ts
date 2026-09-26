import type { Pool } from "pg";

/** Bulk persisted employees; no client-side member or permission response mocks. */
export async function seedMemberPages(db: Pool, workspace: string) {
  await db.query(`update suite.workspaces set seat_limit=200 where id=$1`, [
    workspace,
  ]);
  await db.query(
    `with users as (
    insert into suite.users(id,issuer,subject,email,name,email_verified)
    select gen_random_uuid(),'member-pages',$1 || ':' || g,
      'staff-' || lpad(g::text,3,'0') || '@test.local',
      'Team ' || lpad(g::text,3,'0'), true from generate_series(0,124) g
    returning id, name
  ), members as (
    insert into suite.memberships(id,workspace_id,user_id,active)
    select gen_random_uuid(),$1::uuid,id,name >= 'Team 005' from users returning id,workspace_id
  ) insert into suite.role_assignments(workspace_id,membership_id,role_id)
    select m.workspace_id,m.id,r.id from members m join suite.roles r on r.workspace_id=m.workspace_id and r.name='Viewer'`,
    [workspace],
  );
}
