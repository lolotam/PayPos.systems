import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * الـ transaction اللي كل module بياخدها — ده الشيء الوحيد اللي بيوصل للـ modules من الداتابيز.
 */
export type Tx = Parameters<Parameters<PostgresJsDatabase['transaction']>[0]>[0];

/**
 * بيولّد UUID v7 — port متحقن، عشان withNewTenant متعملش id بنفسها ومتبقاش deterministic في الاختبارات.
 */
export interface IdGenerator {
  newId(): string;
}

/**
 * إعدادات اختيارية لـ withTenant.
 */
export interface TenantOptions {
  /** المستخدم اللي بيعمل التغيير (app.user_id). */
  readonly userId?: string;
  /**
   * أقصى عمر للشغل ده: الـ server بيلغي أي statement أطول، وبيقفل الـ transaction لو فضلت واقفة من غير
   * statement أطول من كده — فشغل واقف ميمسكش connection من الـ pool ولا يعمل commit متأخر.
   */
  readonly timeoutMs?: number;
}

/**
 * نقط الدخول التلاتة للداتابيز (ADR-0003 §3) — كلها transaction-local.
 */
export interface TenantWrappers {
  withTenant<T>(companyId: string, fn: (tx: Tx) => Promise<T>, options?: TenantOptions): Promise<T>;
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  withNewTenant<T>(userId: string, fn: (tx: Tx, companyId: string) => Promise<T>): Promise<T>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const validTimeout = (timeoutMs: number | undefined): number | undefined => {
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 1)) {
    throw new TypeError('timeoutMs must be a whole number of milliseconds > 0');
  }
  return timeoutMs;
};

// id غلط لازم يقع هنا برسالة واضحة، مش جوه policy كـ 22P02 من غير ما نعرف مين بعته.
export function assertUuid(value: string, name: string): string {
  if (!UUID.test(value)) {
    throw new TypeError(`${name} must be a UUID`);
  }
  return value;
}

/**
 * بيبني الـ wrappers التلاتة فوق client واحد من غير ما يطلّعه بره.
 * كل wrapper بيحط الإعدادين الاتنين في كل مرة — اللي مش مستخدم بيبقى '' —
 * عشان connection راجعة من الـ pool متورّثش company أو user من الـ transaction اللي قبلها.
 *
 * @param db  الـ Drizzle client — بيفضل جوه الـ closure
 * @param ids مولّد الـ ids لـ withNewTenant
 * @returns withTenant و withUser و withNewTenant
 */
export function createTenantWrappers(db: PostgresJsDatabase, ids: IdGenerator): TenantWrappers {
  // superuser أو BYPASSRLS بيتجاهل الـ RLS كله، فـ DATABASE_URL غلط كان هيشيل العزل بين الشركات
  // من غير أي خطأ. الفحص في نفس الـ statement اللي بيحط الـ context، فمفيش round-trip زيادة،
  // وبيتكرر في كل transaction عشان يغطي أي reconnect.
  // timeoutMs: statement_timeout يلغي الـ statement الطويل، و idle_in_transaction_session_timeout يقفل الـ session
  // لو الـ transaction فضلت مستنية كود JavaScript واقف — الاتنين على الـ server، فبيشتغلوا حتى لو الكود علّق.
  const limits = (timeoutMs: number | undefined) =>
    timeoutMs === undefined
      ? sql``
      : sql`, set_config('statement_timeout', ${`${timeoutMs}ms`}, true),
             set_config('idle_in_transaction_session_timeout', ${`${timeoutMs}ms`}, true)`;
  const run = <T>(
    companyId: string,
    userId: string,
    fn: (tx: Tx) => Promise<T>,
    timeoutMs?: number,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      const [row] = await tx.execute<{ privileged: boolean }>(
        sql`SELECT set_config('app.company_id', ${companyId}, true),
                   set_config('app.user_id', ${userId}, true)${limits(timeoutMs)},
                   (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS privileged`,
      );
      if (row?.privileged !== false) {
        throw new Error(
          'Refusing to run tenant work as a role that bypasses RLS — check DATABASE_URL',
        );
      }
      return fn(tx);
    });

  // async عشان id غلط يرجع كـ rejected promise زي أي فشل تاني، مش exception متزامن.
  return {
    withTenant: async (companyId, fn, options = {}) =>
      run(
        assertUuid(companyId, 'companyId'),
        options.userId === undefined ? '' : assertUuid(options.userId, 'userId'),
        fn,
        validTimeout(options.timeoutMs),
      ),
    withUser: async (userId, fn) => run('', assertUuid(userId, 'userId'), fn),
    withNewTenant: async (userId, fn) => {
      const companyId = assertUuid(ids.newId(), 'generated companyId');
      return run(companyId, assertUuid(userId, 'userId'), (tx) => fn(tx, companyId));
    },
  };
}
