import postgres from 'postgres';

// حاجز قفل لاختبارات التزامن (نفس فكرة approve-statement-concurrency): اتصال مستقل بيمسك قفل صف الكشف، فالطلبات
// بتبدأ فعلاً وبتقف على القفل (بتتشاف في pg_stat_activity بميزانية محدودة، من غير نوم ثابت)، وبعدين بيتفرج عن القفل.
const WAITERS_BUDGET_MS = 15_000;
const COLLECT_BUDGET_MS = 30_000;
const POLL_MS = 25;

export interface HeldLock {
  readonly release: () => void;
  readonly done: Promise<unknown>;
}

export interface LockBarrier {
  /** يمسك قفل صف الكشف طوال العمل ويفرج عنه في كل الأحوال؛ `beforeRelease` بيشتغل جوّه المعاملة الماسكة قبل الإفراج. */
  readonly whileHoldingLock: <T>(
    work: (lock: HeldLock) => Promise<T>,
    beforeRelease?: (tx: postgres.TransactionSql) => Promise<unknown>,
  ) => Promise<T>;
  /** ينتظر لحد ما `count` اتصالات تقف على قفل، أو يفشل عند انتهاء الميزانية. */
  readonly waitForWaiters: (count: number) => Promise<void>;
  /** يجمع نتائج الطلبات بميزانية محدودة. */
  readonly collect: <T>(promises: Promise<T>[]) => Promise<T[]>;
  readonly end: () => Promise<void>;
}

/**
 * يبني حاجز قفل على كشف شهر معين لنشاط الاختبار.
 *
 * @param ownerUrl رابط اتصال المالك
 * @param target الشركة والنشاط والشهر اللي بيتمسك قفل صفه
 * @param target.company الشركة
 * @param target.business النشاط
 * @param target.period الشهر
 * @returns الحاجز
 */
export function lockBarrier(
  ownerUrl: string,
  target: { company: string; business: string; period: string },
): LockBarrier {
  const connection = postgres(ownerUrl, { max: 3, onnotice: () => undefined });

  async function hold(beforeRelease?: (tx: postgres.TransactionSql) => Promise<unknown>) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const done = connection.begin(async (tx) => {
      await tx`SELECT id FROM commission_statements
        WHERE company_id = ${target.company} AND business_id = ${target.business}
          AND period = ${target.period} FOR UPDATE`;
      locked();
      await released;
      await beforeRelease?.(tx);
    });
    done.catch(() => undefined);
    await lockTaken;
    return { release, done };
  }

  return {
    whileHoldingLock: async (work, beforeRelease) => {
      const lock = await hold(beforeRelease);
      try {
        return await work(lock);
      } finally {
        lock.release();
      }
    },
    waitForWaiters: async (count) => {
      const deadline = performance.now() + WAITERS_BUDGET_MS;
      while (performance.now() < deadline) {
        const [row] = await connection`SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
        if ((row?.['waiting'] as number) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      throw new Error(`fewer than ${count} requests reached a lock within ${WAITERS_BUDGET_MS} ms`);
    },
    collect: (promises) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('the requests did not settle in time')), COLLECT_BUDGET_MS);
      });
      return Promise.race([Promise.all(promises), expired]).finally(() => clearTimeout(timer));
    },
    end: () => connection.end(),
  };
}
