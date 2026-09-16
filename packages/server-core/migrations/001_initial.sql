CREATE SCHEMA IF NOT EXISTS suite;
CREATE TABLE suite.users (
 id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL, email text NOT NULL,
 name text NOT NULL, email_verified boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (issuer, subject)
);
CREATE TABLE suite.workspaces (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('personal','company')), name text NOT NULL,
 owner_user_id uuid NOT NULL REFERENCES suite.users(id), currency text NOT NULL DEFAULT 'EUR' CHECK(currency ~ '^[A-Z]{3}$'),
 seat_limit integer NOT NULL DEFAULT 10 CHECK(seat_limit>0), offline_hours integer NOT NULL DEFAULT 0 CHECK(offline_hours IN (0,24)),
 next_order_number integer NOT NULL DEFAULT 1001, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_personal_workspace ON suite.workspaces(owner_user_id) WHERE kind='personal';
CREATE TABLE suite.memberships (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), user_id uuid NOT NULL REFERENCES suite.users(id),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,user_id), UNIQUE(workspace_id,id)
);
CREATE TABLE suite.roles (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), name text NOT NULL,
 permissions text[] NOT NULL DEFAULT '{}', protected boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(workspace_id,name)
);
CREATE TABLE suite.role_assignments (
 workspace_id uuid NOT NULL, membership_id uuid NOT NULL, role_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,membership_id,role_id),
 FOREIGN KEY(workspace_id,membership_id) REFERENCES suite.memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,role_id) REFERENCES suite.roles(workspace_id,id)
);
CREATE TABLE suite.entitlements (
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), module_id text NOT NULL CHECK(module_id IN ('orders','inventory')),
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(workspace_id,module_id)
);
CREATE TABLE suite.module_activations (
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), module_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('draft','enabled','suspended')), access_policy text NOT NULL DEFAULT 'admin' CHECK(access_policy IN ('self','approval','admin')),
 config jsonb NOT NULL DEFAULT '{}', PRIMARY KEY(workspace_id,module_id),
 FOREIGN KEY(workspace_id,module_id) REFERENCES suite.entitlements(workspace_id,module_id)
);
CREATE TABLE suite.module_assignments (
 workspace_id uuid NOT NULL, membership_id uuid NOT NULL, module_id text NOT NULL,
 PRIMARY KEY(workspace_id,membership_id,module_id),
 FOREIGN KEY(workspace_id,membership_id) REFERENCES suite.memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,module_id) REFERENCES suite.module_activations(workspace_id,module_id)
);
CREATE TABLE suite.invitations (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), email text NOT NULL,
 role_id uuid NOT NULL, invited_by uuid NOT NULL REFERENCES suite.users(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','declined','revoked')),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '7 days'), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,role_id) REFERENCES suite.roles(workspace_id,id)
);
CREATE UNIQUE INDEX one_pending_invitation ON suite.invitations(workspace_id,lower(email)) WHERE state='pending';
CREATE TABLE suite.access_requests (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, membership_id uuid NOT NULL, module_id text NOT NULL,
 reason text NOT NULL DEFAULT '', state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','denied','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,membership_id) REFERENCES suite.memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,module_id) REFERENCES suite.module_activations(workspace_id,module_id)
);
CREATE UNIQUE INDEX one_pending_access_request ON suite.access_requests(workspace_id,membership_id,module_id) WHERE state='pending';
CREATE TABLE suite.products (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), sku text NOT NULL, name text NOT NULL,
 price_minor integer NOT NULL CHECK(price_minor BETWEEN 0 AND 100000000), active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id), UNIQUE(workspace_id,sku)
);
CREATE TABLE suite.stock (
 workspace_id uuid NOT NULL, product_id uuid NOT NULL, on_hand integer NOT NULL DEFAULT 0, reserved integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 1, PRIMARY KEY(workspace_id,product_id),
 FOREIGN KEY(workspace_id,product_id) REFERENCES suite.products(workspace_id,id),
 CHECK(on_hand BETWEEN 0 AND 1000000000), CHECK(reserved>=0 AND reserved<=on_hand)
);
CREATE TABLE suite.customers (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE TABLE suite.orders (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), number integer NOT NULL, customer_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','fulfilled','cancelled')),
 version integer NOT NULL DEFAULT 1, total_minor bigint NOT NULL DEFAULT 0 CHECK(total_minor BETWEEN 0 AND 9000000000000),
 created_by uuid NOT NULL REFERENCES suite.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,number), FOREIGN KEY(workspace_id,customer_id) REFERENCES suite.customers(workspace_id,id)
);
CREATE TABLE suite.order_lines (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, order_id uuid NOT NULL, product_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000), price_minor integer NOT NULL CHECK(price_minor BETWEEN 0 AND 100000000),
 sku_snapshot text NOT NULL, name_snapshot text NOT NULL, UNIQUE(workspace_id,order_id,product_id),
 FOREIGN KEY(workspace_id,order_id) REFERENCES suite.orders(workspace_id,id),
 FOREIGN KEY(workspace_id,product_id) REFERENCES suite.products(workspace_id,id)
);
CREATE TABLE suite.stock_movements (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, product_id uuid NOT NULL, order_id uuid,
 kind text NOT NULL CHECK(kind IN ('receipt','adjustment','reservation','release','fulfillment')),
 on_hand_delta integer NOT NULL, reserved_delta integer NOT NULL, reason text NOT NULL, actor_id uuid NOT NULL REFERENCES suite.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,product_id) REFERENCES suite.products(workspace_id,id),
 FOREIGN KEY(workspace_id,order_id) REFERENCES suite.orders(workspace_id,id)
);
CREATE UNIQUE INDEX one_order_stock_effect ON suite.stock_movements(workspace_id,order_id,product_id,kind) WHERE order_id IS NOT NULL;
CREATE TABLE suite.audit (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), actor_id uuid NOT NULL REFERENCES suite.users(id),
 action text NOT NULL, target_id text NOT NULL, outcome text NOT NULL DEFAULT 'success', request_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE suite.idempotency (
 workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), actor_id uuid NOT NULL REFERENCES suite.users(id), key text NOT NULL,
 operation text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,actor_id,key)
);
CREATE TABLE suite.outbox (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), actor_id uuid NOT NULL REFERENCES suite.users(id),
 event_type text NOT NULL, event_version integer NOT NULL DEFAULT 1, payload jsonb NOT NULL,
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 locked_until timestamptz, claim_token uuid, completed_at timestamptz, failed_at timestamptz, last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_dispatch ON suite.outbox(available_at) WHERE completed_at IS NULL AND failed_at IS NULL;
CREATE TABLE suite.notifications (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), user_id uuid NOT NULL REFERENCES suite.users(id),
 event_id uuid NOT NULL, title text NOT NULL, message text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(event_id,user_id)
);
CREATE TABLE suite.exports (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES suite.workspaces(id), actor_id uuid NOT NULL REFERENCES suite.users(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','failed')), object_key text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE TABLE suite.sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES suite.users(id), csrf_token text NOT NULL, mfa boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE suite.login_attempts (
 state_hash text PRIMARY KEY, verifier text NOT NULL, nonce text NOT NULL, expires_at timestamptz NOT NULL
);
DO $$
DECLARE tab text;
BEGIN
 FOR tab IN SELECT table_name FROM information_schema.columns WHERE table_schema='suite' AND column_name='workspace_id' LOOP
  EXECUTE format('ALTER TABLE suite.%I ENABLE ROW LEVEL SECURITY', tab);
  EXECUTE format('ALTER TABLE suite.%I FORCE ROW LEVEL SECURITY', tab);
  EXECUTE format('CREATE POLICY tenant_isolation ON suite.%I USING (workspace_id = nullif(current_setting(''app.workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id = nullif(current_setting(''app.workspace_id'',true),'''')::uuid)',tab);
 END LOOP;
END $$;
ALTER TABLE suite.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE suite.workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON suite.workspaces USING(id=nullif(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK(id=nullif(current_setting('app.workspace_id',true),'')::uuid);
CREATE FUNCTION suite.list_workspaces(p_user uuid) RETURNS TABLE(id uuid,name text,kind text,currency text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT w.id,w.name,w.kind,w.currency FROM suite.workspaces w JOIN suite.memberships m ON m.workspace_id=w.id WHERE m.user_id=p_user AND m.active ORDER BY w.created_at;
$$;
CREATE FUNCTION suite.pending_invitations(p_email text) RETURNS TABLE(id uuid,workspace_id uuid,workspace_name text,expires_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT i.id,i.workspace_id,w.name,i.expires_at FROM suite.invitations i JOIN suite.workspaces w ON w.id=i.workspace_id WHERE lower(i.email)=lower(p_email) AND i.state='pending' AND i.expires_at>now();
$$;
CREATE FUNCTION suite.claim_jobs(p_limit integer) RETURNS TABLE(id uuid,workspace_id uuid,claim_token uuid)
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 UPDATE suite.outbox SET locked_until=now()+interval '60 seconds',claim_token=gen_random_uuid(),attempts=attempts+1
 WHERE suite.outbox.id IN (SELECT j.id FROM suite.outbox j WHERE j.completed_at IS NULL AND j.failed_at IS NULL AND j.available_at<=now() AND (j.locked_until IS NULL OR j.locked_until<now()) ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT least(p_limit,20))
 RETURNING suite.outbox.id,suite.outbox.workspace_id,suite.outbox.claim_token;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA suite FROM PUBLIC;
GRANT USAGE ON SCHEMA suite TO suite_app, suite_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA suite TO suite_app;
REVOKE UPDATE,DELETE ON suite.audit,suite.stock_movements FROM suite_app;
GRANT EXECUTE ON FUNCTION suite.list_workspaces(uuid),suite.pending_invitations(text) TO suite_app;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA suite TO suite_worker;
REVOKE ALL ON suite.sessions,suite.login_attempts FROM suite_worker;
REVOKE UPDATE ON suite.audit,suite.stock_movements FROM suite_worker;
GRANT EXECUTE ON FUNCTION suite.claim_jobs(integer) TO suite_worker;
