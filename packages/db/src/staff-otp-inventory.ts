import { sql } from 'drizzle-orm';
import type { Tx } from './with-tenant.ts';

const CHALLENGE_UPDATES = [
  'status',
  'failed_attempts',
  'code_mac',
  'consumed_at',
  'finished_at',
  'updated_at',
];
const ATTEMPT_UPDATES = [
  'status',
  'authorized_at',
  'execution_id',
  'sending_at',
  'finished_at',
  'failure_code',
  'outcome_known',
  'provider_message_digest',
  'updated_at',
];

export async function assertOtpInventory(tx: Pick<Tx, 'execute'>): Promise<void> {
  const fail = () => {
    throw new Error('OTP_PRIVILEGES_INVALID');
  };
  const [role] = await tx.execute<{ valid: boolean }>(sql`SELECT current_user = 'pospay_auth'
    AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
    AND NOT has_schema_privilege(r.oid,'public','CREATE') AS valid FROM pg_roles r WHERE rolname=current_user`);
  if (role?.valid !== true) fail();
  for (const [name, updates] of [
    ['auth_otp_challenges', CHALLENGE_UPDATES],
    ['auth_notification_attempts', ATTEMPT_UPDATES],
  ] as const) {
    const [table] = await tx.execute<{ valid: boolean }>(sql`SELECT relowner='pospay_owner'::regrole
      AND NOT relrowsecurity AND NOT relforcerowsecurity
      AND has_table_privilege(current_user,oid,'SELECT') AND has_table_privilege(current_user,oid,'DELETE')
      AND NOT has_table_privilege(current_user,oid,'INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT EXISTS(SELECT 1 FROM pg_roles r WHERE rolname IN ('pospay_app','pospay_dispatcher','pospay_notifications')
        AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
      AND NOT EXISTS(SELECT 1 FROM aclexplode(relacl) WHERE grantee=0) AS valid
      FROM pg_class c WHERE oid=${`public.${name}`}::regclass`);
    if (table?.valid !== true) fail();
    const columns = await tx.execute<{ name: string; writable: boolean; insertable: boolean }>(sql`
      SELECT attname AS name,has_column_privilege(current_user,attrelid,attnum,'UPDATE') AS writable,
        has_column_privilege(current_user,attrelid,attnum,'INSERT') AS insertable
      FROM pg_attribute WHERE attrelid=${`public.${name}`}::regclass AND attnum>0 AND NOT attisdropped`);
    if (columns.some((c) => !c.insertable || c.writable !== updates.includes(c.name))) fail();
  }
  const [suppression] = await tx.execute<{
    valid: boolean;
  }>(sql`SELECT prosecdef AND proowner='pospay_suppression_reader'::regrole
    AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND has_function_privilege(current_user,oid,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM aclexplode(proacl) WHERE grantee=0) AS valid
    FROM pg_proc WHERE oid='public.platform_whatsapp_is_suppressed(bytea)'::regprocedure`);
  const [constraint] = await tx.execute<{
    valid: boolean;
  }>(sql`SELECT convalidated AND pg_get_expr(conbin,conrelid)='(opted_back_in_at IS NULL)' AS valid
    FROM pg_constraint WHERE conrelid='public.platform_whatsapp_suppressions'::regclass AND conname='platform_whatsapp_suppressions_null_only'`);
  if (suppression?.valid !== true || constraint?.valid !== true) fail();
  const forbidden =
    await tx.execute(sql`SELECT c.oid FROM pg_class c WHERE relnamespace='public'::regnamespace
    AND relname IN ('memberships','permission_overrides','devices','cashier_pins','companies','branches','businesses','platform_whatsapp_suppressions','platform_whatsapp_inbox','platform_whatsapp_audit')
    AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))`);
  if (forbidden.length !== 0) fail();
}
