import { sql } from 'drizzle-orm';
import type { Tx } from './with-tenant.ts';

const TABLE_GRANTS = [
  'platform_whatsapp_audit:INSERT',
  'platform_whatsapp_inbox:INSERT',
  'platform_whatsapp_inbox:SELECT',
  'platform_whatsapp_suppressions:SELECT',
];
const COLUMN_GRANTS = [
  'platform_whatsapp_inbox.enqueue_confirmed_at:UPDATE',
  'platform_whatsapp_inbox.processed_at:UPDATE',
  'platform_whatsapp_inbox.raw_event:UPDATE',
  'platform_whatsapp_inbox.suppression_applied_at:UPDATE',
  'platform_whatsapp_suppressions.first_opted_out_at:INSERT',
  'platform_whatsapp_suppressions.hash_key_id:INSERT',
  'platform_whatsapp_suppressions.last_opted_out_at:INSERT',
  'platform_whatsapp_suppressions.last_opted_out_at:UPDATE',
  'platform_whatsapp_suppressions.recipient_hash:INSERT',
  'platform_whatsapp_suppressions.source:INSERT',
  'platform_whatsapp_suppressions.source:UPDATE',
];
const fail = () => {
  throw new Error('PLATFORM_WHATSAPP_PRIVILEGES_INVALID');
};
const same = (values: string[], expected: string[]) =>
  JSON.stringify(values.sort()) === JSON.stringify([...expected].sort());

export async function assertWhatsappRole(tx: Pick<Tx, 'execute'>): Promise<void> {
  const [role] = await tx.execute<{ valid: boolean }>(sql`
    SELECT current_user = 'pospay_notifications' AND NOT rolsuper AND NOT rolbypassrls
      AND NOT rolinherit AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND rolcanlogin
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid OR roleid = r.oid)
      AND has_schema_privilege(r.oid, 'public', 'USAGE')
      AND has_database_privilege(r.oid, current_database(), 'CONNECT')
      AND NOT has_schema_privilege(r.oid, 'public', 'CREATE')
      AND NOT has_database_privilege(r.oid, current_database(), 'CREATE') AS valid
    FROM pg_roles r WHERE rolname = current_user`);
  if (role?.valid !== true) fail();
}

export async function assertWhatsappInventory(tx: Pick<Tx, 'execute'>): Promise<void> {
  await assertWhatsappRole(tx);
  await assertTableGrants(tx);
  await assertGlobalBoundary(tx);
  await assertConstraintAndFunction(tx);
}

async function assertTableGrants(tx: Pick<Tx, 'execute'>): Promise<void> {
  const tables = await tx.execute<{ grant: string }>(sql`
    SELECT c.relname || ':' || p AS grant FROM pg_class c,
      unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege(current_user, c.oid, p)`);
  if (
    !same(
      tables.map((r) => r.grant),
      TABLE_GRANTS,
    )
  )
    fail();
  const columns = await tx.execute<{ grant: string }>(sql`
    SELECT c.relname || '.' || a.attname || ':' || p AS grant
    FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid,
      unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
    WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege(current_user, c.oid, a.attnum, p)
      AND NOT has_table_privilege(current_user, c.oid, p)`);
  if (
    !same(
      columns.map((r) => r.grant),
      COLUMN_GRANTS,
    )
  )
    fail();
  const forbidden = await tx.execute(sql`
    SELECT c.oid FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
      AND (c.relowner = current_user::regrole OR (c.relkind = 'S'
        AND has_sequence_privilege(current_user, c.oid, 'USAGE,SELECT,UPDATE')))`);
  if (forbidden.length !== 0) fail();
}

async function assertGlobalBoundary(tx: Pick<Tx, 'execute'>): Promise<void> {
  const forbidden = await tx.execute(sql`
    SELECT c.oid FROM pg_class c WHERE c.relname IN ('platform_whatsapp_suppressions','platform_whatsapp_inbox','platform_whatsapp_audit')
      AND c.relnamespace = 'public'::regnamespace AND (
        c.relowner <> 'pospay_owner'::regrole OR c.relrowsecurity OR c.relforcerowsecurity
        OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('pospay_app','pospay_auth','pospay_dispatcher')
          AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
        OR EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0)
        OR EXISTS (SELECT 1 FROM pg_attribute a, LATERAL aclexplode(a.attacl) x
          WHERE a.attrelid = c.oid AND x.grantee = 0))`);
  if (forbidden.length !== 0) fail();
  const reader = await tx.execute(sql`
    SELECT r.oid FROM pg_roles r WHERE r.rolname = 'pospay_suppression_reader'
      AND (r.rolsuper OR r.rolbypassrls OR r.rolcanlogin OR r.rolinherit OR r.rolcreatedb
        OR r.rolcreaterole OR r.rolreplication
        OR NOT has_schema_privilege(r.oid,'public','USAGE')
        OR has_schema_privilege(r.oid,'public','CREATE')
        OR has_database_privilege(r.oid,current_database(),'CREATE')
        OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid OR roleid = r.oid))`);
  if (reader.length !== 0) fail();
  const readerTables = await tx.execute<{ grant: string }>(sql`
    SELECT c.relname || ':' || p AS grant FROM pg_class c,
      unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
      AND (has_table_privilege('pospay_suppression_reader',c.oid,p)
        OR (p IN ('SELECT','INSERT','UPDATE','REFERENCES')
          AND has_any_column_privilege('pospay_suppression_reader',c.oid,p)))`);
  if (
    !same(
      readerTables.map((r) => r.grant),
      ['platform_whatsapp_suppressions:SELECT'],
    )
  )
    fail();
  const readerObjects = await tx.execute(sql`SELECT c.oid FROM pg_class c
    WHERE c.relnamespace='public'::regnamespace AND (c.relowner='pospay_suppression_reader'::regrole
      OR (c.relkind='S' AND has_sequence_privilege('pospay_suppression_reader',c.oid,'USAGE,SELECT,UPDATE')))`);
  if (readerObjects.length !== 0) fail();
}

async function assertConstraintAndFunction(tx: Pick<Tx, 'execute'>): Promise<void> {
  const [constraint] = await tx.execute<{ valid: boolean }>(sql`
    SELECT convalidated AND contype = 'c'
      AND pg_get_expr(conbin,conrelid) = '(opted_back_in_at IS NULL)' AS valid
    FROM pg_constraint WHERE conrelid = 'public.platform_whatsapp_suppressions'::regclass
      AND conname = 'platform_whatsapp_suppressions_null_only'`);
  if (constraint?.valid !== true) fail();
  const [fn] = await tx.execute<{ valid: boolean }>(sql`
    SELECT prosecdef AND proowner = 'pospay_suppression_reader'::regrole
      AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']
      AND provolatile = 'v' AND prorettype = 'boolean'::regtype
      AND has_function_privilege('pospay_app',oid,'EXECUTE')
      AND has_function_privilege('pospay_auth',oid,'EXECUTE')
      AND NOT has_function_privilege('pospay_dispatcher',oid,'EXECUTE')
      AND NOT has_function_privilege('pospay_notifications',oid,'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee = 0) AS valid
    FROM pg_proc WHERE oid = 'public.platform_whatsapp_is_suppressed(bytea)'::regprocedure`);
  if (fn?.valid !== true) fail();
}
