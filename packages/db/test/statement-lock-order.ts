import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import { lockStatementPeriods, type Database, type IdGenerator, type Tx } from '../src/index.ts';
import { LOCK_STATEMENT_PERIODS_MARKER } from '../src/statement-periods.ts';

export interface StatementLockOrderOptions {
  readonly db: Database;
  readonly ownerUrl: string;
  readonly companyId: string;
  readonly businessId: string;
  readonly period: string;
  readonly ids: IdGenerator;
  readonly inputTables: readonly string[];
  readonly writer: (tx: Tx) => Promise<unknown>;
  readonly timeoutMs?: number;
}

const sleep = () => new Promise((resolve) => setTimeout(resolve, 20));

// pg_blocking_pids يثبت الانتظار على حامل صف الكشف، لا مجرد افتراض أن الكاتب نادى القفل.
async function waitForBlock(
  observer: postgres.Sql,
  writerPid: () => number | undefined,
  holderPid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const pid = writerPid();
    if (pid !== undefined) {
      const [row] = await observer<{ blocked: boolean }[]>`
        SELECT ${holderPid} = ANY(pg_blocking_pids(${pid})) AS blocked`;
      if (row?.blocked === true) return true;
    }
    await sleep();
  }
  return false;
}

// RowExclusiveLock بديل عملي عن تتبع كل INSERT: وجوده قبل قفل الكشف يكشف الكتابة المبكرة.
async function firstEarlyWrite(
  observer: postgres.Sql,
  writerPid: number,
  inputTables: readonly string[],
): Promise<string | undefined> {
  const [row] = await observer<{ table: string }[]>`
    SELECT relation::regclass::text AS table FROM pg_locks
    WHERE pid = ${writerPid} AND granted AND mode = 'RowExclusiveLock'
      AND relation IS NOT NULL AND relation::regclass::text = ANY(${inputTables}::text[])
    ORDER BY 1 LIMIT 1`;
  return row?.table;
}

// القفل اللي الكاتب واقف عليه لازم يكون قفل المساعد نفسه: يد الكاتب على
// SELECT ... FOR UPDATE بنفسه ما بيثبّتش إن المساعد هو اللي قفل الشهر.
async function blockedOnTheHelper(observer: postgres.Sql, writerPid: number): Promise<boolean> {
  const [row] = await observer<{ query: string }[]>`
    SELECT query FROM pg_stat_activity WHERE pid = ${writerPid}`;
  return row?.query?.includes(LOCK_STATEMENT_PERIODS_MARKER) ?? false;
}

/**
 * يثبت أن كاتب العمولة بيقفل الشهر بمساعد lockStatementPeriods قبل أول جدول مدخلات يكتبه.
 * الفحص بيستنى القفل الفعلي على صف الكشف (مش مجرد افتراض)، وبيقرأ من pg_stat_activity إن
 * الكاتب واقف على قفل المساعد نفسه مش على قفل مكتوب بإيده، وبعدها بيتأكد إن الجدول
 * المدخلات ما اتكتبش قبل القفل.
 * اللي بيثبته: ترتيب أول قفل قبل أول كتابة، جوّه معاملة الكاتب نفسها.
 * اللي ما بيقدرش يثبته: كتابة اتعملت في معاملة تانية، لأن دي مش في معاملته أصلاً.
 *
 * @param options الشركة والشهر ومولّد الـ ids والجداول المدخلات وكاتب يراد اختباره
 * @returns بيخلص لما الكاتب يكون ماشي بالترتيب الصح
 */
export async function expectLockBeforeFirstWrite(
  options: StatementLockOrderOptions,
): Promise<void> {
  await options.db.withTenant(options.companyId, (tx) =>
    lockStatementPeriods(tx, {
      businessId: options.businessId,
      periods: [options.period],
      ids: options.ids,
    }),
  );
  const holder = postgres(options.ownerUrl, { max: 1, onnotice: () => undefined });
  const observer = postgres(options.ownerUrl, { max: 1, onnotice: () => undefined });
  let writer: Promise<unknown> | undefined;
  let writerPid: number | undefined;
  let failure: string | undefined;
  let writerError: unknown;
  try {
    await holder.unsafe('BEGIN');
    const [held] = await holder<{ pid: number }[]>`
      SELECT pg_backend_pid() AS pid FROM commission_statements
      WHERE company_id = ${options.companyId} AND business_id = ${options.businessId}
        AND period = ${options.period} FOR UPDATE`;
    if (held === undefined)
      throw new Error('the statement row is missing before the writer starts');
    writer = options.db.withTenant(options.companyId, async (tx) => {
      const [row] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      writerPid = row?.pid;
      return options.writer(tx);
    });
    writer.catch(() => undefined);
    if (!(await waitForBlock(observer, () => writerPid, held.pid, options.timeoutMs ?? 10_000))) {
      failure =
        'the writer never blocked on the statement lock: it does not call lockStatementPeriods before it finishes';
    } else if (writerPid === undefined) {
      failure = 'the writer never reported its backend pid';
    } else if (!(await blockedOnTheHelper(observer, writerPid))) {
      failure = 'the writer blocked on something other than lockStatementPeriods';
    } else {
      failure = await firstEarlyWrite(observer, writerPid, options.inputTables);
    }
  } finally {
    await holder.unsafe('ROLLBACK').catch(() => undefined);
    await holder.end();
    try {
      await writer;
    } catch (error) {
      writerError = error;
    }
    await observer.end();
  }
  if (failure !== undefined) {
    if (options.inputTables.includes(failure)) {
      throw new Error(`${failure} was written before lockStatementPeriods`);
    }
    throw new Error(failure);
  }
  if (writerError !== undefined) throw writerError;
}
