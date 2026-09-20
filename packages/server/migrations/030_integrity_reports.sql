-- Client observations are append-only diagnostics, never device trust or policy grants.
CREATE TABLE suite.integrity_reports (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id),
 user_id uuid NOT NULL REFERENCES suite.users(id),
 device_id uuid NOT NULL, incident_id uuid NOT NULL,
 event text NOT NULL CHECK (event IN ('locked','recovered')),
 payload jsonb NOT NULL,
 occurred_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,user_id,device_id,incident_id,event)
);
CREATE INDEX integrity_reports_workspace_cursor ON suite.integrity_reports(workspace_id,id);
CREATE INDEX integrity_reports_received ON suite.integrity_reports(received_at);
ALTER TABLE suite.integrity_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE suite.integrity_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON suite.integrity_reports USING (workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id',true),'')::uuid);
CREATE POLICY control_integrity_health ON suite.integrity_reports FOR SELECT TO suite_control USING (true);
GRANT SELECT,INSERT ON suite.integrity_reports TO suite_app;
GRANT SELECT ON suite.integrity_reports TO suite_worker,suite_control;
CREATE FUNCTION suite.integrity_health() RETURNS TABLE(received_last_day bigint,unresolved_reported_incidents bigint,maximum_delivery_delay_seconds double precision)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*) FILTER(WHERE r.received_at >= now()-interval '1 day'),
 count(*) FILTER(WHERE r.event='locked' AND NOT EXISTS (
   SELECT 1 FROM suite.integrity_reports recovered
   WHERE recovered.workspace_id=r.workspace_id AND recovered.user_id=r.user_id
     AND recovered.device_id=r.device_id AND recovered.incident_id=r.incident_id AND recovered.event='recovered'
 )),
 coalesce(max(greatest(0,extract(epoch FROM r.received_at-r.occurred_at))) FILTER(WHERE r.received_at >= now()-interval '1 day'),0)::double precision
 FROM suite.integrity_reports r;
$$;
GRANT CREATE ON SCHEMA suite TO suite_control;
ALTER FUNCTION suite.integrity_health() OWNER TO suite_control;
REVOKE CREATE ON SCHEMA suite FROM suite_control;
REVOKE ALL ON FUNCTION suite.integrity_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION suite.integrity_health() TO suite_worker;
