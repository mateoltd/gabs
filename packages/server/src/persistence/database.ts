import {
  Kysely,
  PostgresDialect,
  sql,
  type Generated,
  type Transaction,
  type ColumnType,
  type LogConfig,
} from "kysely";
import { Pool } from "pg";
type Time = ColumnType<Date, Date | string | undefined, Date | string>;
type Base = { id: string; created_at: Time };
type Tenant = { workspace_id: string };
export interface Database {
  "suite.integrity_reports": Tenant & {
    id: string;
    user_id: string;
    device_id: string;
    incident_id: string;
    event: "locked" | "recovered";
    payload: import("@suite/contracts").IntegrityReport;
    occurred_at: Time;
    received_at: Time;
  };
  "suite.workspace_policy": Tenant & { revision: string };
  "suite.module_storage": Tenant & {
    module_id: string;
    schema_version: number;
    release_version: string;
    updated_at: Time;
  };
  "suite.module_migrations": Tenant & {
    module_id: string;
    from_version: number;
    to_version: number;
    migration_id: string;
    release_version: string;
    actor_id: string;
    applied_at: Time;
  };
  "suite.module_publishers": { id: string; name: string; status: string };
  "suite.module_submissions": {
    id: string;
    module_id: string;
    version: string;
    publisher_id: string;
    client_package: import("@suite/module-sdk/node/signing").SignedPackage;
    server_package:
      import("@suite/module-sdk/node/server-package").ServerPackage | null;
    backend_kind: "none" | "bundled" | "builtin";
    state: "pending" | "approved" | "rejected" | "published";
    staged_at: Time | null;
  };
  "suite.stock_counts": Tenant &
    Base & {
      product_id: string;
      expected_version: number;
      previous_on_hand: number;
      counted_on_hand: number;
      reason: string;
      actor_id: string;
    };
  "suite.billing_routes": { customer_id: string; workspace_id: string };
  "suite.module_records": Tenant & {
    module_id: string;
    resource: string;
    id: string;
    data: Record<string, unknown>;
    version: number;
    archived: boolean;
    created_by: string;
    updated_at: Time;
  };
  "suite.module_revisions": Tenant & {
    module_id: string;
    resource: string;
    record_id: string;
    version: number;
    data: Record<string, unknown>;
  };
  "suite.platform_settings": Tenant & {
    key: string;
    value: Record<string, unknown>;
    version: number;
  };
  "suite.module_installations": Tenant & {
    receipt_id: ColumnType<
      string | null,
      string | null | undefined,
      string | null
    >;
    user_id: string;
    device_id: string;
    module_id: string;
    version: string;
    state: string;
    updated_at: Time;
  };
  "suite.installation_reports": Tenant & {
    user_id: string;
    device_id: string;
    module_id: string;
    attempt_id: string;
    sequence: number;
    version: string | null;
    action: "install" | "uninstall";
    phase: string;
    error_code: string | null;
    receipt_id: string | null;
    created_at: Time;
    updated_at: Time;
  };
  "suite.module_releases": {
    module_id: string;
    version: string;
    manifest: Record<string, unknown>;
    digest: string;
    signature: string;
    key_id: string;
    artifact: Record<string, unknown>;
    published_at: Time;
  };
  "suite.billing_accounts": Tenant & {
    customer_id: string;
    subscription_id: string | null;
    status: string;
    last_event_at: number;
    updated_at: Time;
  };
  "suite.billing_events": { id: string; type: string; processed_at: Time };

  "suite.users": Base & {
    issuer: string;
    subject: string;
    email: string;
    name: string;
    email_verified: boolean;
    active: Generated<boolean>;
  };
  "suite.workspaces": Base & {
    kind: "personal" | "company";
    name: string;
    owner_user_id: string;
    currency: Generated<string>;
    seat_limit: Generated<number>;
    offline_hours: Generated<number>;
    next_order_number: Generated<number>;
    accent: Generated<"forest" | "blue" | "plum">;
    logo_data_url: Generated<string>;
  };
  "suite.memberships": Base &
    Tenant & { user_id: string; active: Generated<boolean> };
  "suite.roles": Base &
    Tenant & {
      name: string;
      permissions: string[];
      protected: Generated<boolean>;
      retired_at: ColumnType<
        Date | null,
        Date | string | null | undefined,
        Date | string | null
      >;
    };
  "suite.role_assignments": Tenant & { membership_id: string; role_id: string };
  "suite.entitlements": Tenant & {
    seat_limit: Generated<number | null>;
    module_id: string;
    active: Generated<boolean>;
  };
  "suite.module_activations": Tenant & {
    module_id: string;
    state: string;
    access_policy: Generated<string>;
    config: Generated<Record<string, unknown>>;
  };
  "suite.registry_revision": { id: boolean; revision: string };
  "suite.module_policy_refresh": Tenant & { registry_revision: string };
  "suite.module_assignments": Tenant & {
    direct: Generated<boolean>;
    membership_id: string;
    module_id: string;
  };
  "suite.invitations": Base &
    Tenant & {
      email: string;
      role_id: string;
      invited_by: string;
      state: Generated<string>;
      expires_at: Time;
    };
  "suite.access_requests": Base &
    Tenant & {
      membership_id: string;
      module_id: string;
      reason: Generated<string>;
      state: Generated<string>;
    };
  "suite.products": Base &
    Tenant & {
      sku: string;
      name: string;
      price_minor: number;
      active: Generated<boolean>;
      version: Generated<number>;
    };
  "suite.stock": Tenant & {
    product_id: string;
    on_hand: Generated<number>;
    reserved: Generated<number>;
    version: Generated<number>;
  };
  "suite.customers": Base & Tenant & { name: string };
  "suite.orders": Base &
    Tenant & {
      number: number;
      customer_id: string;
      status: Generated<string>;
      version: Generated<number>;
      total_minor: ColumnType<string, number, number>;
      created_by: string;
      updated_at: Time;
    };
  "suite.order_lines": Tenant & {
    id: string;
    order_id: string;
    product_id: string;
    quantity: number;
    price_minor: number;
    sku_snapshot: string;
    name_snapshot: string;
  };
  "suite.stock_movements": Base &
    Tenant & {
      product_id: string;
      order_id?: string | null;
      kind: string;
      on_hand_delta: number;
      reserved_delta: number;
      reason: string;
      actor_id: string;
    };
  "suite.audit": Base &
    Tenant & {
      actor_id: string;
      action: string;
      target_id: string;
      outcome: Generated<string>;
      request_id: string;
    };
  "suite.idempotency": Tenant & {
    actor_id: string;
    key: string;
    operation: string;
    request_hash: string;
    outcome: Generated<"accepted" | "cancelled">;
    response: unknown;
    created_at: Time;
  };
  "suite.outbox": Base &
    Tenant & {
      actor_id: string;
      event_type: string;
      event_version: Generated<number>;
      payload: Record<string, unknown>;
      attempts: Generated<number>;
      available_at: Time;
      locked_until: Date | null;
      claim_token: string | null;
      completed_at: Date | null;
      failed_at: Date | null;
      last_error: string | null;
    };
  "suite.notifications": Base &
    Tenant & {
      user_id: string;
      event_id: string;
      title: string;
      message: string;
      read_at: Date | null;
    };
  "suite.exports": Base &
    Tenant & {
      actor_id: string;
      state: Generated<string>;
      object_key: string | null;
    };
  "suite.sessions": {
    token_hash: string;
    user_id: string;
    csrf_token: string;
    mfa: boolean;
    expires_at: Time;
    created_at: Time;
  };
  "suite.login_attempts": {
    state_hash: string;
    verifier: string;
    nonce: string;
    expires_at: Time;
  };
}
export type DB = Kysely<Database>;
export type Tx = Transaction<Database>;
const databasePools = new WeakMap<DB, Pool>();
export function policyListenerPool(db: DB) {
  const pool = databasePools.get(db);
  if (!pool)
    throw Error("Policy delivery requires a managed PostgreSQL connection.");
  return pool;
}
export function connectDatabase(
  url = process.env.DATABASE_URL,
  log?: LogConfig,
) {
  if (!url) throw Error("DATABASE_URL is required");
  const pool = new Pool({
    connectionString: url,
    max: 20,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  // pg emits errors outside pending queries on both checked-out and idle clients.
  // Report the signal without credentials; pending transactions still reject normally.
  pool.on("connect", (client) =>
    client.on("error", (error: Error & { code?: string }) => {
      console.error(
        JSON.stringify({
          event: "database.connection.error",
          code: error.code ?? "CONNECTION_LOST",
        }),
      );
    }),
  );
  pool.on("error", () => {
    /* Already reported by the client listener; pg removes the idle connection. */
  });
  const db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
    log,
  });
  databasePools.set(db, pool);
  return db;
}
const readOnlyTransactions = new WeakSet<Tx>();
/** Only immutable database snapshots can reuse release selection within a request. */
export const isReadOnlyTransaction = (tx: Tx) => readOnlyTransactions.has(tx);

export async function inWorkspace<T>(
  db: DB,
  workspaceId: string,
  fn: (tx: Tx) => Promise<T>,
  options: { readOnly?: boolean; snapshot?: boolean } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const transaction = options.readOnly
        ? db
            .transaction()
            .setIsolationLevel("repeatable read")
            .setAccessMode("read only")
        : options.snapshot
          ? db.transaction().setIsolationLevel("repeatable read")
          : db.transaction();
      return await transaction.execute(async (tx) => {
        if (options.readOnly) readOnlyTransactions.add(tx);
        await sql`select set_config('app.workspace_id',${workspaceId},true)`.execute(
          tx,
        );
        return fn(tx);
      });
    } catch (e) {
      if (
        attempt >= 2 ||
        !["40P01", "40001"].includes((e as { code?: string }).code ?? "")
      )
        throw e;
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
    }
  }
}
