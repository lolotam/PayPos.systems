import { COMMISSION_REMINDER_ALERT_SCHEDULER_RESTORED } from '@pospay/domain';
import type { Logger } from '@pospay/observability';

import {
  REMINDER_COVERAGE_MAX_PAGES,
  REMINDER_COVERAGE_MAX_RESTORES,
  REMINDER_COVERAGE_OPERATION_DEADLINE_MS,
  REMINDER_COVERAGE_PAGE_SIZE,
  REMINDER_COVERAGE_SWEEP_DEADLINE_MS,
} from '../../domain/reminder-recovery.ts';
import type {
  CommissionReminderSchedule,
  ReminderRecoveryReaders,
  ReminderRecoveryStore,
} from '../../ports/reminder-recovery.port.ts';

/** سبب تخطّي الجولة: الشهادة سليمة شرط لازم، وإلا فمسار الاستعادة هو صاحب الحالة. */
export type CoverageSkipReason = 'CERTIFICATE_NOT_HEALTHY' | 'RECOVERY_IN_PROGRESS';

/** نتيجة الجولة الواحدة. */
export interface CoverageSweepResult {
  readonly outcome: 'COMPLETED' | 'PARTIAL' | 'SKIPPED' | 'FAILED' | 'BUSY';
  readonly skipReason: CoverageSkipReason | null;
  /** عدد الشركات اللي اتفحصت جدولتها. */
  readonly scanned: number;
  /** عدد الجدولات الناقصة اللي اتلقت. */
  readonly missing: number;
  /** عدد الجدولات اللي اتسجّلت فعلًا. */
  readonly restored: number;
}

/** كل ما الفحص الدوري يحتاجه: القراءة الضيقة للشركات وقراءة الشهادة وتسجيل الجدولة. */
export interface VerifyCommissionReminderCoverageDeps {
  readonly database: Pick<ReminderRecoveryReaders, 'companyIdPage'>;
  readonly store: Pick<ReminderRecoveryStore, 'snapshot'>;
  readonly schedule: Pick<CommissionReminderSchedule, 'existsAll' | 'register'>;
  readonly clock: { now(): Date };
  readonly logger: Logger;
}

/** حدود الجولة: حجم الصفحة وعدد الصفحات وسقف التسجيل والمهلة الكلية. */
export interface CoverageSweepBounds {
  readonly pageSize: number;
  readonly maxPages: number;
  readonly maxRestores: number;
  readonly sweepDeadlineMs: number;
}

const DEFAULT_BOUNDS: CoverageSweepBounds = {
  pageSize: REMINDER_COVERAGE_PAGE_SIZE,
  maxPages: REMINDER_COVERAGE_MAX_PAGES,
  maxRestores: REMINDER_COVERAGE_MAX_RESTORES,
  sweepDeadlineMs: REMINDER_COVERAGE_SWEEP_DEADLINE_MS,
};

/** يقيّد عملية بمهلة عشان Redis أو القاعدة المعلّقين ما يعلّقوش الجولة. */
async function withDeadline<T>(run: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('COMMISSION_REMINDER_COVERAGE_TIMEOUT')),
      REMINDER_COVERAGE_OPERATION_DEADLINE_MS,
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * يقرر هل الشهادة سليمة بنفس شروط جاهزية الاستعادة: موجودة، من نفس تشغيل Redis الحالي، ومفيش
 * مسار استعادة ماسك الإيجار. غير كده الحالة بتاعة مسار الاستعادة مش الفحص الدوري.
 *
 * @param deps القارئات
 * @returns سبب التخطّي، أو null لو الفحص يكمل
 */
async function skipReason(
  deps: VerifyCommissionReminderCoverageDeps,
): Promise<CoverageSkipReason | null> {
  const snapshot = await withDeadline(() => deps.store.snapshot());
  if (snapshot.lease !== null) return 'RECOVERY_IN_PROGRESS';
  const sentinel = snapshot.sentinel;
  if (
    sentinel === null ||
    snapshot.serverRunId === null ||
    sentinel.runId !== snapshot.serverRunId
  ) {
    return 'CERTIFICATE_NOT_HEALTHY';
  }
  return null;
}

/** حالة الجولة المتراكمة بين الصفحات. */
interface SweepState {
  cursor: string | null;
  scanned: number;
  missing: number;
  restored: number;
  failed: number;
  exhausted: boolean;
  /** لحظة بداية الجولة بالميلي ثانية، لمقارنتها بالمهلة الكلية جوه حلقة التسجيل. */
  readonly startedAt: number;
}

/** يقول هل المهلة الكلية للجولة خلصت. */
function deadlineReached(
  deps: VerifyCommissionReminderCoverageDeps,
  state: SweepState,
  bounds: CoverageSweepBounds,
): boolean {
  return deps.clock.now().getTime() - state.startedAt >= bounds.sweepDeadlineMs;
}

/**
 * يعالج صفحة واحدة: يفحص وجود جدولاتها ويسجّل الناقصة بس (مش الصفحة كلها). السقف بيعدّ
 * التسجيلات الناجحة بس، فصفحة كلها فشل تسجيل (خطأ دائم) بيتقدّم المؤشر بعدها بدل ما الجولة
 * تفضل تلف عليها. المهلة الكلية بتتفحص بين كل تسجيلين، ولو خلصت الصفحة بتتعاد في الجولة الجاية.
 *
 * @param deps   القارئات والجدولة
 * @param state  حالة الجولة (بتتحدّث في مكانها)
 * @param bounds حدود الجولة
 */
async function sweepPage(
  deps: VerifyCommissionReminderCoverageDeps,
  state: SweepState,
  bounds: CoverageSweepBounds,
): Promise<void> {
  const page = await withDeadline(() => deps.database.companyIdPage(state.cursor, bounds.pageSize));
  if (page.length === 0) {
    state.exhausted = true;
    state.cursor = null;
    return;
  }
  const exists = await withDeadline(() => deps.schedule.existsAll(page));
  const absent = page.filter((_, index) => exists[index] !== true);
  state.scanned += page.length;
  state.missing += absent.length;
  for (const companyId of absent) {
    if (state.restored >= bounds.maxRestores || deadlineReached(deps, state, bounds)) return;
    const registration = await withDeadline(() => deps.schedule.register(companyId));
    if (registration.registered) state.restored += 1;
    else state.failed += 1;
  }
  state.cursor = page[page.length - 1] ?? null;
  if (page.length < bounds.pageSize) {
    state.exhausted = true;
    state.cursor = null;
  }
}

/**
 * جولة فحص واحدة (ADR-0061 §8، issue #1220): بتكمل من المؤشر، وبتقرأ صفحات من معرّفات الشركات
 * بالقراءة الضيقة نفسها اللي بتستعملها الاستعادة، وبتتأكد من وجود جدولة كل شركة، وبتسجّل الناقصة
 * بس (upsert idempotent). مفيش إيجار ولا إبطال شهادة ولا حادثة: الجولة لا تمس حالة الاستعادة،
 * فـ`/ready` ما بيتأثرش بيها. قبل كل صفحة بتتأكد إن الشهادة سليمة ومفيش إيجار استعادة، فلو مسار
 * الاستعادة مسك الإيجار في نص الجولة بتقف وتسيبه يكمل. الحدود: صفحة × عدد صفحات، وسقف
 * تسجيلات ناجحة، ومهلة كلية بتمنع بدء صفحة أو تسجيل بعد انتهائها.
 *
 * @param deps   القارئات والجدولة والساعة والسجل
 * @param from   المؤشر اللي بتكمل منه (null = من أول الشركات)
 * @param bounds الحدود (للاختبار فقط)
 * @returns نتيجة الجولة والمؤشر التالي
 */
export async function verifyCommissionReminderCoverage(
  deps: VerifyCommissionReminderCoverageDeps,
  from: string | null,
  bounds: CoverageSweepBounds = DEFAULT_BOUNDS,
): Promise<{ result: CoverageSweepResult; nextCursor: string | null }> {
  const state: SweepState = {
    cursor: from,
    scanned: 0,
    missing: 0,
    restored: 0,
    failed: 0,
    exhausted: false,
    startedAt: deps.clock.now().getTime(),
  };
  try {
    for (let pages = 0; pages < bounds.maxPages && !state.exhausted; pages += 1) {
      if (deadlineReached(deps, state, bounds) || state.restored >= bounds.maxRestores) break;
      const skipped = await skipReason(deps);
      if (skipped !== null) return finish(deps, state, state.cursor, 'SKIPPED', skipped);
      await sweepPage(deps, state, bounds);
    }
  } catch (error) {
    deps.logger.warn({ err: error }, 'commission reminder coverage sweep failed');
    return finish(deps, state, state.cursor ?? from, 'FAILED', null);
  }
  return finish(deps, state, state.cursor, state.exhausted ? 'COMPLETED' : 'PARTIAL', null);
}

/** يبني نتيجة الجولة ويطلق التنبيه لو اتلقت جدولات ناقصة. */
function finish(
  deps: VerifyCommissionReminderCoverageDeps,
  state: SweepState,
  nextCursor: string | null,
  outcome: CoverageSweepResult['outcome'],
  skip: CoverageSkipReason | null,
): { result: CoverageSweepResult; nextCursor: string | null } {
  if (state.missing > 0) {
    deps.logger.warn(
      {
        code: COMMISSION_REMINDER_ALERT_SCHEDULER_RESTORED,
        missing: state.missing,
        restored: state.restored,
        failed: state.failed,
      },
      'commission reminder scheduler restored outside recovery',
    );
  }
  const result = {
    outcome,
    skipReason: skip,
    scanned: state.scanned,
    missing: state.missing,
    restored: state.restored,
  };
  return { result, nextCursor };
}

/** مشغّل الفحص الدوري: بيحتفظ بالمؤشر بين الجولات وبيمنع التداخل (جولة واحدة في المرة). */
export interface CommissionReminderCoverageSweeper {
  /** يشغّل جولة؛ لو جولة تانية شغّالة بيرجع `BUSY` من غير ما يلمس حاجة. */
  run: () => Promise<CoverageSweepResult>;
}

/**
 * يبني مشغّل الفحص الدوري: المؤشر في الذاكرة بيدور على كل الشركات عبر الجولات، وأي فشل
 * بيعيد نفس الصفحة في الجولة الجاية.
 *
 * @param deps   القارئات والجدولة والساعة والسجل
 * @param bounds الحدود: حجم الصفحة وعدد الصفحات وسقف التسجيل والمهلة الكلية (للاختبار فقط)
 * @returns المشغّل
 */
export function createCommissionReminderCoverageSweeper(
  deps: VerifyCommissionReminderCoverageDeps,
  bounds: CoverageSweepBounds = DEFAULT_BOUNDS,
): CommissionReminderCoverageSweeper {
  let cursor: string | null = null;
  let running = false;
  return {
    run: async () => {
      if (running) {
        return { outcome: 'BUSY', skipReason: null, scanned: 0, missing: 0, restored: 0 };
      }
      running = true;
      try {
        const done = await verifyCommissionReminderCoverage(deps, cursor, bounds);
        cursor = done.nextCursor;
        return done.result;
      } finally {
        running = false;
      }
    },
  };
}
