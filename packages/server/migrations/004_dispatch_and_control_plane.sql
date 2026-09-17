-- Discovery functions have only the cross-workspace grants they need, even when
-- migrations run as a database owner without BYPASSRLS.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='suite_control') THEN
  CREATE ROLE suite_control NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
 END IF;
END $$;
GRANT USAGE,CREATE ON SCHEMA suite TO suite_control;
GRANT SELECT ON suite.workspaces,suite.memberships,suite.invitations,suite.outbox TO suite_control;
GRANT UPDATE ON suite.outbox TO suite_control;
CREATE POLICY discovery ON suite.workspaces FOR SELECT TO suite_control USING(true);
CREATE POLICY discovery ON suite.memberships FOR SELECT TO suite_control USING(true);
CREATE POLICY discovery ON suite.invitations FOR SELECT TO suite_control USING(true);
CREATE POLICY dispatch ON suite.outbox TO suite_control USING(true) WITH CHECK(true);
CREATE OR REPLACE FUNCTION suite.claim_jobs(p_limit integer) RETURNS TABLE(id uuid,workspace_id uuid,claim_token uuid)
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 BEGIN
  UPDATE suite.outbox j SET failed_at=now(),locked_until=NULL,last_error='LEASE_RETRIES_EXHAUSTED'
   WHERE j.completed_at IS NULL AND j.failed_at IS NULL AND j.attempts>=5 AND (j.locked_until IS NULL OR j.locked_until<now());
  RETURN QUERY UPDATE suite.outbox j SET locked_until=now()+interval '60 seconds',claim_token=gen_random_uuid(),attempts=j.attempts+1
   WHERE j.id IN (SELECT q.id FROM suite.outbox q WHERE q.completed_at IS NULL AND q.failed_at IS NULL AND q.available_at<=now() AND (q.locked_until IS NULL OR q.locked_until<now()) ORDER BY q.created_at FOR UPDATE SKIP LOCKED LIMIT greatest(0,least(p_limit,20)))
   RETURNING j.id,j.workspace_id,j.claim_token;
 END;
$$;
ALTER FUNCTION suite.list_workspaces(uuid) OWNER TO suite_control;
ALTER FUNCTION suite.pending_invitations(text) OWNER TO suite_control;
ALTER FUNCTION suite.resolve_invitation(uuid,text) OWNER TO suite_control;
ALTER FUNCTION suite.claim_jobs(integer) OWNER TO suite_control;
REVOKE CREATE ON SCHEMA suite FROM suite_control;
CREATE INDEX membership_discovery ON suite.memberships(user_id,workspace_id) WHERE active;
CREATE INDEX invitations_account ON suite.invitations(lower(email),expires_at) WHERE state='pending';
CREATE INDEX movement_history ON suite.stock_movements(workspace_id,product_id,id);
CREATE INDEX notifications_page ON suite.notifications(workspace_id,user_id,id);
CREATE INDEX audit_page ON suite.audit(workspace_id,id);
CREATE INDEX exports_page ON suite.exports(workspace_id,actor_id,id);
CREATE INDEX access_page ON suite.access_requests(workspace_id,id);
