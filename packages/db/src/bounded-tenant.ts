import { sql } from 'drizzle-orm';
import { assertUuid, type TenantOptions, type Tx } from './with-tenant.ts';
import type { boundedPostgres } from './bounded-postgres.ts';

/** نفس withTenant وRLS، باتصال مملوك ومصرف بالكامل لطلبات تجهيز OTP المحدودة. */
export function boundedTenant<T>(
  pool: ReturnType<typeof boundedPostgres>,
  companyId: string,
  work: (tx: Tx) => Promise<T>,
  options: TenantOptions,
) {
  const company = assertUuid(companyId, 'companyId');
  const actor = options.userId === undefined ? '' : assertUuid(options.userId, 'userId');
  const timeout = options.timeoutMs;
  if (timeout === undefined || !Number.isInteger(timeout) || timeout < 1)
    throw new Error('BOUNDED_TENANT_INVALID');
  return pool.run(
    async (tx) => {
      const [role] = await tx.execute<{ valid: boolean }>(sql`SELECT
      set_config('app.company_id',${company},true),set_config('app.user_id',${actor},true),
      set_config('statement_timeout',${`${Math.min(timeout, 100)}ms`},true),
      set_config('lock_timeout',${`${Math.min(timeout, 100)}ms`},true),
      set_config('idle_in_transaction_session_timeout',${`${Math.min(timeout, 100)}ms`},true),
      current_user='pospay_app' AND NOT rolsuper AND NOT rolbypassrls AS valid FROM pg_roles WHERE rolname=current_user`);
      if (role?.valid !== true) throw new Error('BOUNDED_TENANT_REFUSED');
      return work(tx);
    },
    new Date(Date.now() + timeout),
  );
}
