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
   * أقصى عمر للشغل ده كله، من أول انتظار connection لحد الـ commit. بعده الـ promise بيترفض بـ TimeoutError،
   * الشغل اللي لسه مستني connection مبيبدأش، واللي خلص بعد الموعد مبيعملش COMMIT أبداً. لكن لو الـ COMMIT
   * بدأ قبل الموعد، نتيجته هي اللي بترجع حتى لو خلص بعده — عشان الـ caller ميتقالوش "فشل" على حاجة اتسجلت؛
   * ولو ردّ الـ COMMIT مجاش خلال مدة كمان، بيترفض بـ CommitOutcomeUnknownError (النتيجة مش معروفة).
   * على الـ server كل statement وكل فترة سكون جوه الـ transaction محدودين بنفس المدة.
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

// What a transaction under a deadline checks: when it starts and just before it commits (refuse if too late).
interface DeadlineGate {
  onStart(): void;
  beforeCommit(): void;
}
const OPEN_GATE: DeadlineGate = { onStart: () => undefined, beforeCommit: () => undefined };

// Named TimeoutError, a name the log diagnostics already recognise.
const timeoutError = (): Error =>
  Object.assign(new Error('transaction deadline passed'), { name: 'TimeoutError' });

// A COMMIT whose reply never came: it may or may not have committed, so the caller must reconcile, not assume.
const commitOutcomeUnknown = (): Error =>
  Object.assign(new Error('no reply to COMMIT; outcome unknown'), {
    name: 'CommitOutcomeUnknownError',
  });

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

// statement_timeout بيتعاد مع كل statement (PG16 مفيهوش transaction_timeout)، فالـ deadline هنا مطلق من ناحية
// الـ caller: بعده الـ promise بيترفض، الشغل اللي لسه مستني connection مبيبدأش، واللي خلص متأخر مبيعملش COMMIT؛
// أما COMMIT اتبعت قبل الموعد فنتيجته هي اللي بترجع — ولو ردّه متأخرش أكتر من مدة كمان، وإلا
// CommitOutcomeUnknownError: ممكن يكون اتسجل وممكن لأ، والـ caller لازم يتأكد مش يفترض.
// الـ connection نفسها بتفضل محجوزة لحد ما الـ socket يتقفل — TCP keepalive بيبدأ يفحص بعد 60 ثانية سكون، ومش موعد مضمون:
// قفلها بإيدينا بالـ pid مش آمن، لأن لو الرد وصل في نفس اللحظة الـ connection ممكن تكون راحت لـ transaction تانية.
// مفيش إنهاء للـ backend من بره: pg_terminate_backend بالـ pid مينفعش يبقى atomic مع التأكد إن الـ connection لسه
// في نفس الـ transaction، فممكن يقتل شغل تاني استلم الـ connection. اللي بيحد الـ backend على الـ server:
// statement_timeout و idle_in_transaction_session_timeout (limits)، والـ connection بترجع أول ما الكود يخلص.
export function withDeadline<T>(
  timeoutMs: number,
  start: (gate: DeadlineGate) => Promise<T>,
): Promise<T> {
  const endsAt = performance.now() + timeoutMs;
  let expired = false;
  let committing = false;
  let timer: NodeJS.Timeout | undefined;
  let watchdog: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (committing) {
        // A COMMIT already sent may still succeed, so its reply is the answer — for as long again at most.
        watchdog = setTimeout(() => reject(commitOutcomeUnknown()), timeoutMs);
        return;
      }
      expired = true;
      reject(timeoutError());
    }, timeoutMs);
  });
  // The clock, not only the timer: a blocked event loop can hold the timer past the deadline.
  const refuseIfLate = (): void => {
    if (expired || performance.now() >= endsAt) {
      expired = true;
      throw timeoutError();
    }
  };
  // beforeCommit runs after the work and before COMMIT: work that finished late rolls back, and from here on
  // the COMMIT's own outcome is the answer.
  const work = start({
    onStart: refuseIfLate,
    beforeCommit: () => {
      refuseIfLate();
      committing = true;
    },
  });
  work.catch(() => undefined);
  return Promise.race([work, deadline]).finally(() => {
    clearTimeout(timer);
    clearTimeout(watchdog);
  });
}

// statement_timeout يلغي الـ statement الطويل، و idle_in_transaction_session_timeout يقفل الـ session لو الـ transaction
// فضلت مستنية كود JavaScript واقف — الاتنين على الـ server، فبيشتغلوا حتى لو الكود علّق.
function limits(timeoutMs: number | undefined) {
  return timeoutMs === undefined
    ? sql``
    : sql`, set_config('statement_timeout', ${`${timeoutMs}ms`}, true),
           set_config('idle_in_transaction_session_timeout', ${`${timeoutMs}ms`}, true)`;
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
  const run = <T>(
    companyId: string,
    userId: string,
    fn: (tx: Tx) => Promise<T>,
    timeoutMs?: number,
    gate: DeadlineGate = OPEN_GATE,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      gate.onStart();
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
      const result = await fn(tx);
      gate.beforeCommit();
      return result;
    });

  // async عشان id غلط يرجع كـ rejected promise زي أي فشل تاني، مش exception متزامن.
  return {
    withTenant: async (companyId, fn, options = {}) => {
      const company = assertUuid(companyId, 'companyId');
      const user = options.userId === undefined ? '' : assertUuid(options.userId, 'userId');
      const timeoutMs = validTimeout(options.timeoutMs);
      return timeoutMs === undefined
        ? run(company, user, fn)
        : withDeadline(timeoutMs, (gate) => run(company, user, fn, timeoutMs, gate));
    },
    withUser: async (userId, fn) => run('', assertUuid(userId, 'userId'), fn),
    withNewTenant: async (userId, fn) => {
      const companyId = assertUuid(ids.newId(), 'generated companyId');
      return run(companyId, assertUuid(userId, 'userId'), (tx) => fn(tx, companyId));
    },
  };
}
