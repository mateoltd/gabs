CREATE FUNCTION suite.resolve_invitation(p_id uuid,p_email text) RETURNS TABLE(workspace_id uuid)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT i.workspace_id FROM suite.invitations i WHERE i.id=p_id AND lower(i.email)=lower(p_email);
$$;
REVOKE ALL ON FUNCTION suite.resolve_invitation(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION suite.resolve_invitation(uuid,text) TO suite_app;
