import { sql } from 'drizzle-orm';
import {
  assertNotificationsGrants,
  assertNotificationsRole,
  same,
} from './platform-notifications-inventory.ts';
import type { Tx } from './with-tenant.ts';

const fail = () => {
  throw new Error('PLATFORM_NOTIFICATIONS_PRIVILEGES_INVALID');
};

export async function assertWhatsappInventory(tx: Pick<Tx, 'execute'>): Promise<void> {
  await assertNotificationsRole(tx);
  await assertNotificationsGrants(tx);
  await assertGlobalBoundary(tx);
  await assertConstraintAndFunction(tx);
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
