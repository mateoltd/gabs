CREATE FUNCTION suite.job_health() RETURNS TABLE(pending bigint,failed bigint,oldest_pending_seconds double precision)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*) FILTER(WHERE completed_at IS NULL AND failed_at IS NULL),count(*) FILTER(WHERE failed_at IS NOT NULL),coalesce(extract(epoch FROM now()-min(created_at) FILTER(WHERE completed_at IS NULL AND failed_at IS NULL)),0)::double precision FROM suite.outbox;
$$;
GRANT CREATE ON SCHEMA suite TO suite_control;
ALTER FUNCTION suite.job_health() OWNER TO suite_control;
REVOKE CREATE ON SCHEMA suite FROM suite_control;
REVOKE ALL ON FUNCTION suite.job_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION suite.job_health() TO suite_worker;
