import { sql } from 'drizzle-orm';
import type { TenantWrappers } from '@pospay/db';
import type postgres from 'postgres';
import { expect } from 'vitest';

/**
 * ميزانية الزمن بالملّي ثانية. الطلب التاني بيستنى الـ claim 5000 كحد أقصى (lockTimeoutMs الافتراضي في runIdempotent)،
 * والمراقبة والسحب لازم يخلصوا جوه النافذة دي بس، وإلا الطلب التاني بيفشل بمهلته هو قبل ما الصلاحية تتسحب.
 *
 *   وصول الطلب الأول للبوابة     10000   (قبل بدء الطلب التاني)
 *   مراقبة الانتظار على الـ claim  2000   ┐ جوه نافذة الـ claim 5000،
 *   سحب الصلاحية                  1500   ┘ والهامش المتبقي 1500
 *   انتظار انتهاء الطلب التاني     8000   (وضع holdUntilSecondSettles فقط: مهلة الـ claim 5000 + هامش 3000)
 *   جمع نتيجتي الطلبين            5000   (بعد فتح البوابة)
 *   سقف المساعد كله              26500   (deadline واحد؛ كل خطوة بتاخد min(ميزانيتها، المتبقي))
 *   مهلة الاختبار              40000   = السقف + إعداد وتحقق (≈ 2000) + هامش (REPLAY_TEST_TIMEOUT_MS)
 *
 * استعلامات الاتصال المالك بتتلغي (cancel) لما ميزانيتها تخلص، والطلبان نفسيهما (ملك التطبيق) بنتوقف عن انتظارهم
 * عند انتهاء مهلة الجمع وبيتقفلوا مع الـ fixture.
 */
const GATE_REACH_BUDGET_MS = 10_000;
const OBSERVE_BUDGET_MS = 2_000;
const REVOKE_BUDGET_MS = 1_500;
const SETTLE_BUDGET_MS = 8_000;
const COLLECT_BUDGET_MS = 5_000;
const TOTAL_BUDGET_MS = 26_500;
const POLL_STATEMENT_MS = 1_000;
/** مهلة الاختبار الصريحة للسيناريوهات (بدل تغيير الإعداد العام). */
export const REPLAY_TEST_TIMEOUT_MS = 40_000;

const STILL_PENDING = Symbol('still pending');

/** يرفض الوعد لو ما خلصش في المهلة، والرسالة بتسمّي الخطوة. */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms} ms`)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/** ينتظر الوعد لحد المهلة، ولو انتهت يرجّع STILL_PENDING (بنتوقف عن الانتظار من غير ما نرمي). */
function within<T>(work: Promise<T>, ms: number): Promise<T | typeof STILL_PENDING> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof STILL_PENDING>((resolve) => {
    timer = setTimeout(() => resolve(STILL_PENDING), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/**
 * يشغّل استعلاماً على الاتصال المالك بميزانية واحدة تشمل الانتظار قبل البدء والتنفيذ: حد على الخادم،
 * وعند انتهاء الميزانية بيتلغي الاستعلام المعلّق (cancel) والمعاملة بترجع للخلف، فالنتيجة المتأخرة ما بتتقبلش أبداً.
 */
function bounded<T extends postgres.Row[]>(
  owner: postgres.Sql,
  ms: number,
  label: string,
  run: (tx: postgres.TransactionSql) => postgres.PendingQuery<T>,
): Promise<T> {
  let expired = false;
  let pending: postgres.PendingQuery<T> | undefined;
  const work = owner.begin(async (tx) => {
    if (expired) throw new Error(`${label} expired before it started`);
    await tx.unsafe(`SET LOCAL statement_timeout = ${ms}`);
    if (expired) throw new Error(`${label} expired before it started`);
    pending = run(tx);
    return pending;
  }) as Promise<T>;
  work.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      pending?.cancel();
      reject(new Error(`${label} did not finish within ${ms} ms`));
    }, ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** يستنى لحد ما الشرط يتحقق، أو يرجّع false عند انتهاء الميزانية أو لما `stop()` يرجّع true (الطلب خلص أو فشل). */
async function observed(
  condition: (remainingMs: number) => Promise<boolean>,
  stop: () => boolean,
  budgetMs: number,
): Promise<boolean> {
  const deadline = performance.now() + budgetMs;
  while (performance.now() < deadline && !stop()) {
    const matched = await condition(deadline - performance.now()).catch(() => false);
    if (performance.now() > deadline) return false;
    if (matched) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

/** غلاف قاعدة بيسجّل رقم اتصال Postgres للمعاملة اللي بيفتحها الكاتب، عشان الانتظار يتربط بالطلبين بالاسم. */
export interface TrackedDatabase {
  readonly database: TenantWrappers;
  /** رقم الاتصال (pg_backend_pid) لآخر معاملة فتحها الكاتب، أو undefined قبل ما تبدأ. */
  readonly pid: () => number | undefined;
  /** يمسح الرقم المسجّل، عشان معاملات طلبات سابقة ما تتحسبش للطلب الجاي. */
  readonly reset: () => void;
}

/**
 * يلفّ غلاف قاعدة البيانات ويسجّل pg_backend_pid داخل معاملة الشركة نفسها قبل أي شغل للكاتب.
 *
 * @param database غلاف قاعدة البيانات الحقيقي
 * @returns الغلاف المسجِّل ورقم اتصال معاملته
 */
export function trackBackend(database: TenantWrappers): TrackedDatabase {
  let pid: number | undefined;
  const tracked = Object.create(database) as TenantWrappers;
  tracked.withTenant = (companyId, work, options) =>
    database.withTenant(
      companyId,
      async (tx) => {
        const [row] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        pid = row?.pid;
        return work(tx);
      },
      options,
    );
  return {
    database: tracked,
    pid: () => pid,
    reset: () => {
      pid = undefined;
    },
  };
}

export interface BackendPids {
  readonly first: number | undefined;
  readonly second: number | undefined;
}

/**
 * الطلب التاني بالذات (اتصاله معروف) واقف على استعلام الـ claim (INSERT في idempotency_keys) بسبب اتصال الأول.
 * ما بنقبلش أي تطابق قبل ما يتعرف رقم اتصال التاني.
 */
const claimWaiterObserved = (owner: postgres.Sql, pids: () => BackendPids, stop: () => boolean) =>
  observed(
    async (remainingMs) => {
      const { first, second } = pids();
      if (first === undefined || second === undefined) return false;
      const [row] = await bounded(
        owner,
        Math.max(1, Math.min(POLL_STATEMENT_MS, Math.floor(remainingMs))),
        'observing the claim wait',
        (tx) => tx`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity waiting
      WHERE waiting.pid = ${second}::int AND waiting.datname = current_database()
        AND waiting.wait_event_type = 'Lock'
        AND waiting.query ~* '^\\s*INSERT\\s+INTO\\s+idempotency_keys'
        AND ${first}::int = ANY(pg_blocking_pids(waiting.pid))) AS blocked`,
      );
      return row?.['blocked'] === true;
    },
    stop,
    OBSERVE_BUDGET_MS,
  );

export interface ReplayAccessBarrier {
  /** الاتصال المالك لمراقبة pg_stat_activity (اتصال واحد، فمفيش معاملة ماسكة عليه). */
  readonly owner: postgres.Sql;
  /** أرقام اتصال الطلبين، من الغلافين المسجِّلين. */
  readonly pids: () => BackendPids;
  /** يبدأ الطلب الأول: لازم ينادي `reachedGate` بعد ما يخلّص شغله وقبل ما يستنى `gate` بمعاملته مفتوحة. */
  readonly startFirst: (gate: Promise<void>, reachedGate: () => void) => Promise<unknown>;
  /** يبدأ الطلب التاني على نفس المفتاح (بصمة زي الأول أو مختلفة) وشغله لازم يرمي لو اتنفّذ. */
  readonly startSecond: () => Promise<unknown>;
  /** يسحب الصلاحية بـ SQL مباشر؛ ده بيتخطى أقفال مسار إدارة الصلاحيات، فالاختبار بيثبت ترتيب الفحص بعد الانتظار بس. لو غاب الصلاحية بتفضل ممنوحة. */
  readonly revoke?: () => Promise<unknown>;
  /** يفضّل البوابة مقفولة لحد ما الطلب التاني ينتهي (بنهاية مهلة الـ claim مثلاً)، بدل فتحها بعد السحب مباشرة. */
  readonly holdUntilSecondSettles?: boolean;
}

export interface ReplayAccessOutcome {
  readonly blocked: boolean;
  /** كود الخطأ اللي طلع للتاني، أو 'answered' لو اتردّ عليه. */
  readonly secondOutcome: string | undefined;
  /** القيمة اللي رجعها الطلب التاني لو اتردّ عليه (رد HTTP مثلاً). */
  readonly secondValue: unknown;
  /** وصف نتيجة الطلبين للرسالة لو الانتظار ما اتشافش. */
  readonly diagnostic: string;
}

/** بوابة بتفضل مقفولة لحد `open()`، أو لحد مهلة الأمان، عشان الطلب الأول ما يعلقش للأبد. */
function holdableGate() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timer = setTimeout(() => release(), TOTAL_BUDGET_MS);
  return {
    gate,
    open: () => {
      clearTimeout(timer);
      release();
    },
  };
}

/** يبدأ الطلب التاني ويتتبّع هل خلص ونتيجته، من غير ما وعده يرفض أبداً. */
function trackSecond(start: () => Promise<unknown>) {
  const state: { settled: boolean; value: unknown } = { settled: false, value: undefined };
  const outcome = start().then(
    (value) => {
      state.settled = true;
      state.value = value;
      return 'answered';
    },
    (error: unknown) => {
      state.settled = true;
      return (error as { code?: string }).code ?? String(error);
    },
  );
  return { state, outcome };
}

const revokeIfAny = async (barrier: ReplayAccessBarrier) => {
  if (barrier.revoke !== undefined) await barrier.revoke();
};

/** يستنى الطلب التاني لحد ما ينتهي (بنجاح أو بخطأ) أو يفشل لو عدّت الميزانية. */
async function holdUntilSettled(second: ReturnType<typeof trackSecond>, ms: number) {
  if ((await within(second.outcome, ms)) === STILL_PENDING) {
    throw new Error(`the second request did not settle within ${ms} ms`);
  }
}

const describeFirst = (first: Promise<unknown>) =>
  first.then(
    () => 'completed',
    (error: unknown) => `rejected ${(error as { code?: string }).code ?? String(error)}`,
  );

/**
 * يشغّل طلبين على نفس المفتاح: التاني بيبدأ بعد ما الأول يوصل البوابة، وبيتأكد إن الأول بالذات حاجزه على الـ claim
 * قبل سحب الصلاحية. deadline واحد (TOTAL_BUDGET_MS) على كل المراحل، والبوابة بتتفتح دايماً، ونتيجة الطلبين بتتجمّع
 * بمهلة حتى لو المراقبة أو السحب فشلوا؛ فشل المراقبة بيرمي بعد الجمع برسالة فيها نتيجة الطلبين.
 *
 * @param barrier الاتصال والطلبان وسحب الصلاحية
 * @returns هل التاني اتشاف محجوب بالأول على الـ claim، ونتيجته ووصف الطلبين
 */
export async function replayAfterRevocation(
  barrier: ReplayAccessBarrier,
): Promise<ReplayAccessOutcome> {
  const startedAt = performance.now();
  const left = (budgetMs: number) =>
    Math.max(1, Math.min(budgetMs, TOTAL_BUDGET_MS - (performance.now() - startedAt)));
  const { gate, open } = holdableGate();
  let reachedGate: () => void = () => undefined;
  const atGate = new Promise<void>((resolve) => {
    reachedGate = resolve;
  });
  let firstFailed = false;
  const first = barrier.startFirst(gate, reachedGate);
  const firstEnded = first.then(
    () => undefined,
    () => {
      firstFailed = true;
    },
  );
  let second: ReturnType<typeof trackSecond> | undefined;
  let blocked = false;
  let failure: unknown;
  try {
    const ended = firstEnded.then(() => Promise.reject(new Error('the first request ended early')));
    await withTimeout(
      Promise.race([atGate, ended]),
      left(GATE_REACH_BUDGET_MS),
      'reaching the gate',
    );
    second = trackSecond(barrier.startSecond);
    const stop = () => firstFailed || second?.state.settled === true;
    blocked = await claimWaiterObserved(barrier.owner, barrier.pids, stop);
    if (blocked) await withTimeout(revokeIfAny(barrier), left(REVOKE_BUDGET_MS), 'revoking');
    if (blocked && barrier.holdUntilSecondSettles === true) {
      await holdUntilSettled(second, left(SETTLE_BUDGET_MS));
    }
  } catch (error) {
    failure = error;
  } finally {
    open();
  }
  const collectMs = left(COLLECT_BUDGET_MS);
  const [firstResult, secondOutcome] = await Promise.all([
    within(describeFirst(first), collectMs),
    within(second?.outcome ?? Promise.resolve(undefined), collectMs),
  ]);
  const text = (value: unknown) => (value === STILL_PENDING ? 'still pending (abandoned)' : value);
  const secondValue = second?.state.value;
  const secondText =
    second === undefined
      ? 'not started'
      : `${text(secondOutcome)} ${JSON.stringify(secondValue) ?? ''}`;
  const diagnostic = `first request: ${text(firstResult)}; second request: ${secondText}`;
  const pending = firstResult === STILL_PENDING || secondOutcome === STILL_PENDING;
  if (failure !== undefined || pending) {
    throw new Error(`replay barrier failed (${diagnostic})`, { cause: failure });
  }
  return { blocked, secondOutcome: secondOutcome as string | undefined, secondValue, diagnostic };
}

/** يمنح عضوية صلاحية خطط العمولة على النشاط بـ override ويرجّع هويته للسحب بعدين. */
export async function grantPlanPermission(
  owner: postgres.Sql,
  scope: { company: string; business: string; userId: string; membershipId: string; id: string },
): Promise<void> {
  await owner`INSERT INTO permission_overrides(
    company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${scope.company},${scope.id}::uuid,${scope.membershipId}::uuid,
      'manage:commission-plans:business','ALLOW','BUSINESS',${scope.business}::uuid,
      'replay barrier proof',${scope.userId})`;
}

export const revokePlanPermission = (owner: postgres.Sql, company: string, id: string) =>
  bounded(
    owner,
    REVOKE_BUDGET_MS,
    'revoking the permission override',
    (tx) => tx`DELETE FROM permission_overrides WHERE company_id=${company} AND id=${id}::uuid`,
  );

/**
 * يثبت إن الرد المخزّن للمفتاح فضل زي ما هو: صف واحد بحالة 201 وجسم الرد الأول بالظبط.
 *
 * @param owner الاتصال المالك
 * @param stored الشركة والعملية والمفتاح والرد اللي رجّعه الطلب الأول
 */
export async function expectStoredResponseUnchanged(
  owner: postgres.Sql,
  stored: { company: string; operation: string; key: string; response: unknown },
): Promise<void> {
  const claims = await owner`SELECT response_status, response_body FROM idempotency_keys
    WHERE company_id=${stored.company} AND operation=${stored.operation} AND key=${stored.key}`;
  expect(claims).toHaveLength(1);
  expect(claims[0]?.['response_status']).toBe(201);
  expect(claims[0]?.['response_body']).toEqual(JSON.parse(JSON.stringify(stored.response)));
}

/** يمنح عضوية صلاحية خطط العمولة عبر دورها (المسار اللي بيعدّي حارس HTTP). */
export const grantRolePermission = (owner: postgres.Sql, company: string, membershipId: string) =>
  owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    SELECT role_id,role_owner_key,company_id,'manage:commission-plans:business' FROM memberships
    WHERE company_id=${company} AND id=${membershipId}`;

/** يسحب الصلاحية اللي منحها grantRolePermission من دور العضوية بـ SQL مباشر. */
export const revokeRolePermission = (owner: postgres.Sql, company: string, membershipId: string) =>
  bounded(
    owner,
    REVOKE_BUDGET_MS,
    'revoking the role permission',
    (tx) => tx`DELETE FROM role_permissions
      WHERE company_id=${company} AND permission_code='manage:commission-plans:business'
        AND role_id=(SELECT role_id FROM memberships WHERE company_id=${company} AND id=${membershipId})`,
  );

/**
 * يثبت إن رد الطلب التاني هو نفس رد الرفض العادي بالظبط: 403 وجسم الخطأ كله زي رد طلب بلا صلاحية، بلا `details`.
 *
 * @param second القيمة اللي رجعها الطلب التاني (رد HTTP)
 * @param plain رد الرفض العادي لنفس العضوية قبل منح الصلاحية
 */
export function expectPlainRefusal(second: unknown, plain: { body: Record<string, unknown> }) {
  const response = second as { status: number; body: Record<string, unknown> };
  expect(response.status).toBe(403);
  expect(response.body).toEqual(plain.body);
  expect(response.body).not.toHaveProperty('details');
}
