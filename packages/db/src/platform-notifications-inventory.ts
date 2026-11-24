import { sql } from 'drizzle-orm';
import type { Tx } from './with-tenant.ts';

// The notifications role serves both global messaging classes: WhatsApp (ADR-0013) and email
// (ADR-0014 addendum). Its privilege set is exactly the two classes' grants — every class inventory
// requires its own entries and refuses anything outside this set.
export const WHATSAPP_TABLE_GRANTS = [
  'platform_whatsapp_audit:INSERT',
  'platform_whatsapp_inbox:INSERT',
  'platform_whatsapp_inbox:SELECT',
  'platform_whatsapp_suppressions:SELECT',
];

export const WHATSAPP_COLUMN_GRANTS = [
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

export const EMAIL_TABLE_GRANTS = [
  'platform_email_audit:INSERT',
  'platform_email_feedback_inbox:INSERT',
  'platform_email_feedback_inbox:SELECT',
  'platform_email_suppressions:INSERT',
  'platform_email_suppressions:SELECT',
];

export const EMAIL_COLUMN_GRANTS = [
  'platform_email_feedback_inbox.attempts:UPDATE',
  'platform_email_feedback_inbox.enqueue_confirmed_at:UPDATE',
  'platform_email_feedback_inbox.next_attempt_at:UPDATE',
  'platform_email_feedback_inbox.quarantine_reason:UPDATE',
  'platform_email_feedback_inbox.quarantined_at:UPDATE',
  'platform_email_feedback_inbox.raw_event:UPDATE',
  'platform_email_feedback_inbox.resolved_at:UPDATE',
  'platform_email_suppressions.last_suppressed_at:UPDATE',
  'platform_email_suppressions.source:UPDATE',
];

const TABLE_GRANTS = [...WHATSAPP_TABLE_GRANTS, ...EMAIL_TABLE_GRANTS];
const COLUMN_GRANTS = [...WHATSAPP_COLUMN_GRANTS, ...EMAIL_COLUMN_GRANTS];

const fail = () => {
  throw new Error('PLATFORM_NOTIFICATIONS_PRIVILEGES_INVALID');
};
export const same = (values: string[], expected: string[]) =>
  JSON.stringify(values.sort()) === JSON.stringify([...expected].sort());

/** the role itself: a plain login with no superuser, no BYPASSRLS and no role membership */
export async function assertNotificationsRole(tx: Pick<Tx, 'execute'>): Promise<void> {
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

/** the exact privilege set of the role: the two global classes and nothing else */
export async function assertNotificationsGrants(tx: Pick<Tx, 'execute'>): Promise<void> {
  const tables = await tx.execute<{ grant: string }>(sql`
    SELECT c.relname || ':' || p AS grant FROM pg_class c,
      unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege(current_user, c.oid, p)`);
  if (!same(tables.map((r) => r.grant), TABLE_GRANTS)) fail();
  const columns = await tx.execute<{ grant: string }>(sql`
    SELECT c.relname || '.' || a.attname || ':' || p AS grant
    FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid,
      unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
    WHERE c.relnamespace = 'public'::regnamespace AND a.attnum > 0 AND NOT a.attisdropped
      AND has_column_privilege(current_user, c.oid, a.attnum, p)
      AND NOT has_table_privilege(current_user, c.oid, p)`);
  if (!same(columns.map((r) => r.grant), COLUMN_GRANTS)) fail();
  const forbidden = await tx.execute(sql`
    SELECT c.oid FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
      AND (c.relowner = current_user::regrole OR (c.relkind = 'S'
        AND has_sequence_privilege(current_user, c.oid, 'USAGE,SELECT,UPDATE')))`);
  if (forbidden.length !== 0) fail();
}
