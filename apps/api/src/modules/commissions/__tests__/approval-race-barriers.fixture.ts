import { COMMISSION_COVERAGE_PROOF_VERSION } from '@pospay/domain';
import postgres from 'postgres';
import { onTestFinished } from 'vitest';

// حاجز سباقات الاعتماد (ADR-0054 §8 و§10 اختبار 6). كل حاجز قفل حقيقي: قفل جدول يوقف الاعتماد بعد بوابة
// التغطية (الخطوة 5) وقبل التجميد (الخطوة 8)، أو معاملة ممسوكة تختار الاختبار وقت الـCOMMIT. الاستطلاع
// بميزانية محدودة وبلا نوم ثابت، وكل حاجز بيتفرّج عنه في finally عشان ما يعلّقش التشغيل.
const POLL_MS = 25;
const BUDGET_MS = 15_000;

/** معرّف صف الحالة: بوابة الاعتماد والإبطال والإصدار تمسك الصف ده لكل شركة. */
export const STATE_ID = '01980000-0000-7000-8000-0000000000e1';

export interface RaceConnections {
  /** القارئ: pg_locks وpg_stat_activity وكتالوج قاعدة البيانات. */
  readonly observer: postgres.Sql;
  /** حامل قفل التجميد (دور المالك). */
  readonly freeze: postgres.Sql;
  /** حامل معاملة الإبطال (دور التطبيق pospay_app). */
  readonly app: postgres.Sql;
  /** حامل معاملة الإصدار (دور المرسّل pospay_dispatcher). */
  readonly dispatcher: postgres.Sql;
  /** حامل هجرة الإصدار (دور المالك). */
  readonly owner: postgres.Sql;
  /** يقفل كل الاتصالات. */
  end(): Promise<void>;
}

/**
 * يفتح اتصالات السباق على قواعد الاختبار: قارئ، وحامل قفل تجميد، وحامل إبطال، وحامل إصدار، وحامل هجرة.
 *
 * @param urls روابط قاعدة الاختبار (التطبيق والمرسّل والمالك)
 * @returns اتصالات السباق
 */
export async function raceConnections(urls: {
  readonly app: string;
  readonly dispatcher: string;
  readonly owner: string;
}): Promise<RaceConnections> {
  const observer = postgres(urls.owner, { max: 2, onnotice: () => undefined });
  const freeze = postgres(urls.owner, { max: 1, onnotice: () => undefined });
  const app = postgres(urls.app, { max: 2, onnotice: () => undefined });
  const dispatcher = postgres(urls.dispatcher, { max: 2, onnotice: () => undefined });
  const owner = postgres(urls.owner, { max: 2, onnotice: () => undefined });
  return {
    observer,
    freeze,
    app,
    dispatcher,
    owner,
    end: async () => {
      await Promise.all([
        observer.end(),
        freeze.end(),
        app.end(),
        dispatcher.end(),
        owner.end(),
      ]);
    },
  };
}

export interface HeldLock {
  /** يفرج عن القفل فينتظر ما كان واقف عليه. */
  release(): void;
  /** يتحل لما المعاملة الماسكة تلتزم. */
  done: Promise<unknown>;
}

/**
 * يحجز قفل جدول صفوف الكشف المجمّدة (ACCESS EXCLUSIVE)، فيتوقف الاعتماد عند التجميد — أي بعد بوابة التغطية
 * (الخطوة 5) فلمسكه قفل صف الحالة FOR SHARE، وقبل كتابة الصفوف المجمّدة (الخطوة 8). الـrelease لازم ينادي
 * في كل الأحوال حتى لو فشل الاختبار.
 *
 * @param owner اتصال المالك
 * @returns القفل الممسوك
 */
export async function holdFreezeGate(owner: postgres.Sql): Promise<HeldLock> {
  let release: () => void = () => undefined;
  let acquired: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const took = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const done = owner.begin(async (tx) => {
    await tx`LOCK TABLE public.commission_statement_lines IN ACCESS EXCLUSIVE MODE`;
    acquired();
    await released;
  });
  done.catch(() => undefined);
  await took;
  // القفل بيتفرّج عنه في كل الأحوال (حتى لو فشل تأكيد في نصّ الاختبار)، فما بيقفلش باقي الاختبارات.
  onTestFinished(async () => {
    release();
    await done.catch(() => undefined);
  });
  return { release, done };
}

interface Held {
  /** معرّف العملية اللي ماسكة المعاملة. */
  readonly pid: number;
  /** يتحل لما الشغل جوه المعاملة يخلص والقفل ممسوك. */
  readonly work: Promise<unknown>;
  /** يتحل لما المعاملة تلتزم. */
  readonly done: Promise<unknown>;
  /** يفرج عن المعاملة فيرسلها تلتزم. */
  release(): void;
}

/**
 * يفتح معاملة على اتصال مستقل، ينفّذ الشغل جواها (فتُقفل الصفوف)، ويبقيها مفتوحة حتى يُستدعى release.
 *
 * @param sql الاتصال
 * @param work الشغل جوه المعاملة
 * @returns المعاملة الممسوكة
 */
export async function holdTransaction(
  sql: postgres.Sql,
  work: (tx: postgres.TransactionSql) => Promise<unknown>,
): Promise<Held> {
  let release: () => void = () => undefined;
  let opened: (pid: number) => void = () => undefined;
  let finished: (value: unknown) => void = () => undefined;
  let failed: (error: unknown) => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const workDone = new Promise<unknown>((resolve, reject) => {
    finished = resolve;
    failed = reject;
  });
  const pidReady = new Promise<number>((resolve) => {
    opened = resolve;
  });
  const done = sql.begin(async (tx) => {
    const [row] = await tx`SELECT pg_backend_pid()::int AS pid`;
    opened(row?.['pid'] as number);
    try {
      const result = await work(tx);
      finished(result);
    } catch (error) {
      failed(error);
      throw error;
    }
    await released;
  });
  const pid = await pidReady;
  // المعاملة الممسوكة بتلتزم في كل الأحوال (حتى لو فشل تأكيد في نصّ الاختبار)، فما بتقفلش باقي الاختبارات.
  onTestFinished(async () => {
    release();
    await done.catch(() => undefined);
  });
  return { pid, work: workDone, done: done.catch(() => undefined), release };
}

/**
 * معرّفات العمليات اللي ماسكة قفل معرّف عملية معيّن (اللي بيستنى عليه).
 *
 * @param observer القارئ
 * @param pid معرّف العملية المنتظرة
 * @returns معرّفات الحاجزين
 */
export async function blockersOf(observer: postgres.Sql, pid: number): Promise<number[]> {
  const rows = await observer<{ pid: number }[]>`
    SELECT unnest(pg_blocking_pids(${pid}))::int AS pid`;
  return rows.map((row) => row.pid);
}

/**
 * معرّفات العمليات اللي ماسكة قفل صف الحالة FOR SHARE (قفل بوابة الاعتماد).
 *
 * @param observer القارئ
 * @returns معرّفات الحاملين
 */
export async function stateShareHolders(observer: postgres.Sql): Promise<number[]> {
  const rows = await observer<{ pid: number }[]>`
    SELECT pid FROM pg_locks
    WHERE locktype = 'tuple' AND mode = 'ShareLock' AND granted
      AND relation = 'public.commission_coverage_state'::regclass`;
  return rows.map((row) => row.pid);
}

/**
 * ينتظر حتى يقف معرّف عملية معيّن على قفل، أو يفشل عند انتهاء الميزانية.
 *
 * @param observer القارئ
 * @param pid معرّف العملية المنتظرة
 * @param what اسم ما ينتظره الاختبار
 * @returns معرّفات الحاجزين وقت الانتظار
 */
export async function waitForBlockers(
  observer: postgres.Sql,
  pid: number,
  what: string,
): Promise<number[]> {
  const deadline = Date.now() + BUDGET_MS;
  for (;;) {
    const blockers = await blockersOf(observer, pid);
    if (blockers.length > 0) return blockers;
    if (Date.now() >= deadline) {
      throw new Error(`${what}: the transaction ${pid} never waited on a lock within ${BUDGET_MS} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * ينتظر حتى يمسك الاعتماد قفل صف الحالة FOR SHARE (يعني إنه عدّى بوابة التغطية)، أو يفشل عند انتهاء الميزانية.
 *
 * @param observer القارئ
 * @param what اسم ما ينتظره الاختبار
 * @returns معرّفات الحاملين وقت الانتظار
 */
export async function waitForStateShareLock(
  observer: postgres.Sql,
  what: string,
): Promise<number[]> {
  const deadline = Date.now() + BUDGET_MS;
  for (;;) {
    const holders = await stateShareHolders(observer);
    if (holders.length > 0) return holders;
    if (Date.now() >= deadline) {
      throw new Error(
        `${what}: no transaction held the coverage state row FOR SHARE within ${BUDGET_MS} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * ينتظر حتى يظهر اعتماد واقف على بوابة التغطية وممسوك من معرّف معيّن، أو يفشل عند انتهاء الميزانية.
 *
 * @param observer القارئ
 * @param holderPid معرّف العملية الحاجبة
 * @param what اسم ما ينتظره الاختبار
 */
export async function waitForGateWaiter(
  observer: postgres.Sql,
  holderPid: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + BUDGET_MS;
  while (Date.now() < deadline) {
    const [row] = await observer<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND ${holderPid} = ANY(pg_blocking_pids(pid))
        AND query LIKE '%read_commission_coverage_gate%'`;
    if ((row?.['waiting'] ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`${what}: no approval waited at the coverage gate within ${BUDGET_MS} ms`);
}

/**
 * يجمع نتائج الطلبات بميزانية محدودة، فما يعلقش التشغيل لو طلب ما خلصش.
 *
 * @param promises الطلبات
 * @returns نتائج الطلبات
 */
export function collect<T>(promises: Promise<T>[]): Promise<T[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('the requests did not settle in time')),
      BUDGET_MS * 2,
    );
  });
  return Promise.race([Promise.all(promises), expired]).finally(() => clearTimeout(timer));
}

let proofCounter = 0;

/**
 * يقرأ الجيل الحالي لصف الحالة بدالة المرسّل، كما يفعل أمر التغطية قبل الإصدار.
 *
 * @param observer القارئ
 * @param company الشركة
 * @returns جيل صف الحالة
 */
export async function currentGeneration(observer: postgres.Sql, company: string): Promise<number> {
  const [row] = await observer<{ generation: string }[]>`
    SELECT out_generation::text AS generation
    FROM public.current_commission_coverage_generation(${company}::uuid, ${STATE_ID}::uuid)`;
  return Number(row?.['generation']);
}

/**
 * يصدر إثباتًا بدور المرسّل على الجيل المتوقع، كما يفعل أمر التغطية.
 *
 * @param observer القارئ (ل هوية قاعدة البيانات وحدّ البقشيش)
 * @param tx معاملة المرسّل
 * @param company الشركة
 * @param business نشاط الشركة الوحيد
 * @param generation الجيل المتوقع
 * @returns الجيل اللي اتحمل عليه الإثبات
 */
export async function issueProofOn(
  observer: postgres.Sql,
  tx: postgres.TransactionSql,
  company: string,
  business: string,
  generation: number,
): Promise<number> {
  const [identity] = await observer<{ name: string; system_id: string; bound: string }[]>`
    SELECT current_database()::text AS name, public.pospay_system_id()::text AS system_id,
      ((now() AT TIME ZONE 'UTC')::date + 1)::text AS bound`;
  if (identity === undefined) throw new Error('the database identity is unavailable');
  proofCounter += 1;
  const proofId = `01980000-0000-7000-8000-${(0xcc0100 + proofCounter).toString(16).padStart(12, '0')}`;
  const [row] = await tx`SELECT public.issue_commission_coverage_proof(
    ${company}::uuid, ${proofId}::uuid, ${generation}::bigint,
    ${COMMISSION_COVERAGE_PROOF_VERSION}::integer, ARRAY[${business}]::uuid[],
    '2026-01-01'::date, ${identity.bound}::date, ${identity.bound}::date, NULL::uuid,
    ${identity.name}::text, ${identity.system_id}::bigint, 'race-run', 'race')::text AS generation`;
  return Number(row?.['generation']);
}
