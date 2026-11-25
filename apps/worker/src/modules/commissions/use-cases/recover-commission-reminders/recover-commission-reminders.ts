import {
  COMMISSION_REMINDER_ALERT_COMPANY_PARKED,
  COMMISSION_REMINDER_ALERT_RECERTIFICATION_FAILED,
  COMMISSION_REMINDER_SCHEDULES_LOST_CODE,
} from '@pospay/domain';

import {
  REMINDER_RECOVERY_LEASE_TTL_SECONDS,
  REMINDER_RECOVERY_PAGE_DEADLINE_MS,
} from '../../domain/reminder-recovery.ts';
import { rebuildAll } from './rebuild-company-schedules.ts';
import {
  RecoveryStalled,
  bounded,
  createProgress,
  type RecoveryProgress,
} from './recovery-bounds.ts';
import { bindIncident, paceSlot, raiseIncident } from './recovery-incident.ts';
import { RecoveryLeaseKeeper } from './recovery-lease-keeper.ts';
import type {
  PassContext,
  RecoverCommissionRemindersDeps,
  RecoverCommissionRemindersInput,
  RecoveryIncident,
  RecoveryOutcome,
  RecoveryResult,
} from './recovery-types.ts';

export { RecoveryLeaseKeeper } from './recovery-lease-keeper.ts';
export type {
  RecoverCommissionRemindersDeps,
  RecoverCommissionRemindersInput,
  RecoveryClock,
  RecoveryIncident,
  RecoveryMode,
  RecoveryOutcome,
  RecoveryResult,
  RecoveryTimeouts,
} from './recovery-types.ts';

/**
 * مسار الاستعادة الواحد (ADR-0061 §4): في فحص `DETECT` يتحقّق بلا إيجار أولًا عشان حالة
 * السليم ما ترفعش `RECOVERY_IN_PROGRESS` على `/ready` (P2-3)، ولو في سبب نشط أو وضع بداية/مشغّل
 * يحجز المفتاح، يقرّر الحادثة تحت الملكية، يعيد بناء جدولة كل شركة، ثم يمسح وينشر.
 *
 * @param deps  القارئات والمتجر والجدولة
 * @param input سبب البدء
 * @returns نتيجة المسار
 */
export async function recoverCommissionReminders(
  deps: RecoverCommissionRemindersDeps,
  input: RecoverCommissionRemindersInput,
): Promise<RecoveryResult> {
  const passId = deps.ids.newId();
  const progress = createProgress(deps);
  const limit = deps.pageDeadlineMs ?? REMINDER_RECOVERY_PAGE_DEADLINE_MS;
  let runId: string | null;
  try {
    runId = await bounded(deps, progress, 'server-run-id', limit, () => deps.store.serverRunId());
    if (runId === null) return failed(deps, passId, 'NO_SERVER_RUN_ID');
    if (input.mode === 'DETECT') {
      const preview = await detect(deps, runId, progress);
      if (!preview.anyTrigger) return idle(passId, 'NOTHING_NEEDED', null);
    }
    const acquired = await bounded(deps, progress, 'acquire', limit, () =>
      deps.store.acquire({
        passId,
        runId: runId as string,
        incidentId: null,
        ttlSeconds: REMINDER_RECOVERY_LEASE_TTL_SECONDS,
      }),
    );
    if (!acquired) return idle(passId, 'BUSY', null);
  } catch (error) {
    return handleUnleasedError(deps, passId, error);
  }
  const keeper = new RecoveryLeaseKeeper(deps.store, passId, runId, deps.logger);
  keeper.start();
  const ctx: PassContext = { passId, runId, mode: input.mode, keeper, incident: null };
  try {
    return await runPass(deps, input, ctx, progress);
  } catch (error) {
    return await handleOwnedError(deps, ctx, error);
  } finally {
    keeper.stop();
  }
}

/** خطأ قبل حجز المفتاح: لا يوجد إيجار لتحريره. */
function handleUnleasedError(
  deps: RecoverCommissionRemindersDeps,
  passId: string,
  error: unknown,
): RecoveryResult {
  if (error instanceof RecoveryStalled) {
    deps.logger.warn({ operation: error.operation }, 'commission reminder recovery stalled');
    return failed(deps, passId, 'PASS_STALLED');
  }
  deps.logger.warn({ err: error }, 'commission reminder recovery pass failed');
  return failed(deps, passId, 'PASS_ERROR');
}

/** مهلة مستقلة لتحرير الإيجار عند أي خروج حتى لا يعلّق الفشل بسبب Redis. */
const RELEASE_LEASE_TIMEOUT_MS = 3_000;

/** يحرّر إيجار الاستعادة بمهلة مستقلة؛ أخطاء التحرير تُسجّل ولا تطغى على نتيجة المسار. */
async function releaseLease(deps: RecoverCommissionRemindersDeps, passId: string): Promise<void> {
  const limit = Math.min(
    deps.pageDeadlineMs ?? REMINDER_RECOVERY_PAGE_DEADLINE_MS,
    RELEASE_LEASE_TIMEOUT_MS,
  );
  const releasing = deps.store.release(passId);
  void releasing.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      releasing,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('REMINDER_RECOVERY_RELEASE_TIMEOUT')), limit);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    deps.logger.warn({ err: error, passId }, 'commission reminder recovery release failed');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** خطأ أثناء امتلاك المفتاح: يوقف التجديد، يحرّر المفتاح بمهلة محدودة، ولا يمسح ولا ينشر. */
async function handleOwnedError(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  error: unknown,
): Promise<RecoveryResult> {
  ctx.keeper.stop();
  await releaseLease(deps, ctx.passId);
  if (error instanceof RecoveryStalled) {
    deps.logger.warn({ operation: error.operation }, 'commission reminder recovery stalled');
    return failed(deps, ctx.passId, 'PASS_STALLED', ctx.incident?.id ?? null);
  }
  deps.logger.warn({ err: error }, 'commission reminder recovery pass failed');
  return failed(deps, ctx.passId, 'PASS_ERROR', ctx.incident?.id ?? null);
}

/** نتيجة بلا عمل: المسار ما لمسش حاجة وساب المفتاح. */
function idle(passId: string, outcome: RecoveryOutcome, incidentId: string | null): RecoveryResult {
  return { outcome, passId, companies: 0, rebuilt: 0, incidentId };
}

/**
 * جسم المسار بعد الحجز: الفحص تحت الملكية، ثم الإيقاع، ثم تقرير الحادثة، ثم إعادة البناء،
 * ثم المسح والنشر.
 *
 * @param deps     القارئات والمتجر والجدولة
 * @param input    سبب البدء
 * @param ctx      سياق المسار
 * @param progress تتبّع التقدّم والمهل
 * @returns نتيجة المسار
 */
async function runPass(
  deps: RecoverCommissionRemindersDeps,
  input: RecoverCommissionRemindersInput,
  ctx: PassContext,
  progress: RecoveryProgress,
): Promise<RecoveryResult> {
  const limit = deps.pageDeadlineMs ?? REMINDER_RECOVERY_PAGE_DEADLINE_MS;
  const detected = await detect(deps, ctx.runId, progress);
  // مخرج «مفيش حاجة مطلوبة» مشروط بإن كل الأسباب الحالية اختفت مش بس الأصلي (البند 7 من #1222).
  if (!detected.anyTrigger && input.mode !== 'STARTUP') {
    ctx.keeper.stop();
    await releaseLease(deps, ctx.passId);
    const outcome = input.mode === 'OPERATOR' ? 'STALE_OPERATOR_INCIDENT' : 'NOTHING_NEEDED';
    return idle(ctx.passId, outcome, null);
  }
  if (
    input.mode === 'OPERATOR' &&
    (!input.incidentId || detected.incident?.id !== input.incidentId)
  ) {
    // البند 6 من #1222: المشغّل يقبل حادثة مفتوحة مسمّاة ومطابقة بس.
    ctx.keeper.stop();
    await releaseLease(deps, ctx.passId);
    return idle(ctx.passId, 'STALE_OPERATOR_INCIDENT', detected.incident?.id ?? null);
  }
  ctx.incident = detected.incident;
  const paced = await bounded(deps, progress, 'pace-slot', limit, () => paceSlot(deps, ctx));
  if (paced === 'LOST_OWNERSHIP') return abandon(deps, ctx, 'PACE_SLOT_LOST');
  if (paced === 'REFUSED_PACING') {
    ctx.keeper.stop();
    await releaseLease(deps, ctx.passId);
    return idle(ctx.passId, 'REFUSED_PACING', detected.incident?.id ?? null);
  }
  if (detected.parkedCompanies.length > 0 || detected.overflow) {
    deps.logger.warn(
      {
        code: COMMISSION_REMINDER_ALERT_COMPANY_PARKED,
        companies: detected.parkedCompanies.length,
      },
      'commission reminder recovery alert',
    );
  }
  return await decideAndRebuild(deps, ctx, progress, detected);
}

/** نتيجة الفحص: الشروط النشطة والحادثة المتحققة. */
interface Detection {
  readonly sentinelValid: boolean;
  /** الشهادة غايبة أو من تشغيل Redis تاني: خسارة بتتسجّل حادثة في غير البداية. */
  readonly sentinelLost: boolean;
  readonly incident: RecoveryIncident | null;
  readonly anyTrigger: boolean;
  /** معرّفات أحداث `CompanyCreated` الموقوفة اللي جدولة تذكيراتها فعلًا ناقصة في Redis. */
  readonly parkedCompanies: readonly string[];
  readonly overflow: boolean;
}

/**
 * الفحص (ADR-0061 §4 الخطوة 2 والبند 2 من #1222 وP2-4): الشهادة، ومعرّف تشغيل الخادم،
 * والعلم المفتوح، والمسند P. كل نداء للقاعدة أو الجدولة مقيد بمهلة عشان ما يعلّقش الإيجار.
 *
 * @param deps     القارئات والمتجر والجدولة
 * @param runId    معرّف تشغيل Redis الحالي
 * @param progress تتبّع التقدّم والمهل
 * @returns نتيجة الفحص
 */
async function detect(
  deps: RecoverCommissionRemindersDeps,
  runId: string,
  progress: RecoveryProgress,
): Promise<Detection> {
  const limit = deps.pageDeadlineMs ?? REMINDER_RECOVERY_PAGE_DEADLINE_MS;
  const snapshot = await bounded(deps, progress, 'snapshot', limit, () => deps.store.snapshot());
  const flags = await bounded(deps, progress, 'open-flags', limit, () =>
    deps.database.openRecoveryFlags(),
  );
  const open = flags.find((flag) => flag.code === COMMISSION_REMINDER_SCHEDULES_LOST_CODE) ?? null;
  let parkedCompanies: readonly string[] = [];
  let overflow = false;
  let clockRegressed = false;
  const sentinel = snapshot.sentinel;
  if (sentinel !== null) {
    const cutoff = new Date(sentinel.cutoff);
    const parked = await bounded(deps, progress, 'parked-read', limit, () =>
      deps.database.parkedCompanyCreatedAfter(cutoff, sentinel.cutoffSeq),
    );
    parkedCompanies = await withMissingScheduler(deps, progress, parked.companyIds);
    overflow = parked.overflow;
    clockRegressed = parked.dbNow.getTime() < cutoff.getTime();
  }
  const sentinelLost = sentinel === null || sentinel.runId !== runId;
  const sentinelValid = !sentinelLost && !clockRegressed;
  return {
    sentinelValid,
    sentinelLost,
    incident: open === null ? null : { id: open.id, raisedAt: new Date(open.raisedAt) },
    anyTrigger: !sentinelValid || open !== null || parkedCompanies.length > 0 || overflow,
    parkedCompanies,
    overflow,
  };
}

/**
 * يصفّي الشركات الموقوفة لتلك اللي جدولة تذكيراتها غايبة فعلًا من Redis بمهلة محدودة.
 *
 * @param deps       الجدولة
 * @param progress   تتبّع التقدّم والمهل
 * @param companyIds معرّفات شركات أحداث `CompanyCreated` الموقوفة
 * @returns اللي جدولته ناقصة منها
 */
async function withMissingScheduler(
  deps: RecoverCommissionRemindersDeps,
  progress: RecoveryProgress,
  companyIds: readonly string[],
): Promise<readonly string[]> {
  if (companyIds.length === 0) return [];
  const limit = deps.pageDeadlineMs ?? REMINDER_RECOVERY_PAGE_DEADLINE_MS;
  const exists = await bounded(deps, progress, 'parked-schedulers', limit, () =>
    deps.schedule.existsAll(companyIds),
  );
  return companyIds.filter((_, index) => exists[index] !== true);
}

/**
 * تقرير الحادثة تحت الملكية ثم إعادة البناء ثم المسح والنشر (ADR-0061 §4 الخطوات 2 إلى 5).
 *
 * @param deps     القارئات والمتجر والجدولة
 * @param ctx      سياق المسار
 * @param progress تتبّع التقدّم والمهل
 * @param detected نتيجة الفحص
 * @returns نتيجة المسار
 */
async function decideAndRebuild(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  progress: RecoveryProgress,
  detected: Detection,
): Promise<RecoveryResult> {
  const limit = deps.pageDeadlineMs ?? REMINDER_RECOVERY_PAGE_DEADLINE_MS;
  if (!(await adoptAtStart(deps, ctx, progress, detected))) {
    return abandon(deps, ctx, 'INCIDENT_NOT_ADOPTED');
  }
  const cutoff = await bounded(deps, progress, 'sample-cutoff', limit, () =>
    deps.database.sampleReminderRecoveryCutoff(),
  );
  const rebuilt = await rebuildAll(deps, ctx, progress);
  if (rebuilt === null) return abandon(deps, ctx, 'REBUILD_FAILED');
  const incident = ctx.incident;
  const base = { passId: ctx.passId, companies: rebuilt.companies, rebuilt: rebuilt.registered };
  if (incident !== null) {
    const cleared = await bounded(deps, progress, 'clear-incident', limit, () =>
      clearIncident(deps, ctx, incident, rebuilt.registered),
    );
    if (!cleared) {
      ctx.keeper.stop();
      await releaseLease(deps, ctx.passId);
      return { outcome: 'FAILED', ...base, incidentId: incident.id };
    }
  }
  const published = await bounded(deps, progress, 'publish', limit, () =>
    deps.store.publish({
      passId: ctx.passId,
      incidentId: incident?.id ?? null,
      runId: ctx.runId,
      release: deps.release,
      cutoff: cutoff.cutoff.toISOString(),
      cutoffSeq: cutoff.maxOutboxSeq,
    }),
  );
  if (!published) {
    ctx.keeper.stop();
    await releaseLease(deps, ctx.passId);
  }
  return { outcome: published ? 'PUBLISHED' : 'FAILED', ...base, incidentId: incident?.id ?? null };
}

/**
 * يتبنّى الحادثة المفتوحة أو يرفع واحدة لو الشهادة اتفقدت في مسار مش بداية. البداية والمسند P
 * بيستنوا إعادة البناء: لو لقت شركة ناقصة بترفع الحادثة وقتها.
 *
 * @param deps     القارئات والمتجر
 * @param ctx      سياق المسار
 * @param progress تتبّع التقدّم والمهل
 * @param detected نتيجة الفحص
 * @returns هل التبنّي نجح (الفشل معناه فقد الملكية أو علم اتقفل في الأثناء)
 */
async function adoptAtStart(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  progress: RecoveryProgress,
  detected: Detection,
): Promise<boolean> {
  if (detected.incident !== null) return bindIncident(deps, ctx, progress, detected.incident);
  if (detected.sentinelLost && ctx.mode !== 'STARTUP') {
    return (await raiseIncident(deps, ctx, progress)) !== null;
  }
  return true;
}

/**
 * مسار وقف قبل ما يكمل: يوقف التجديد، يحرّر المفتاح بمقارنة `pass_id`، ومفيش مسح ولا نشر.
 *
 * @param deps   المتجر والسجل
 * @param ctx    سياق المسار
 * @param reason سبب التوقف
 * @returns نتيجة فشل ثابتة
 */
async function abandon(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  reason: string,
): Promise<RecoveryResult> {
  ctx.keeper.stop();
  await releaseLease(deps, ctx.passId);
  return failed(deps, ctx.passId, reason, ctx.incident?.id ?? null);
}

/**
 * يمسح الحادثة بعد إعادة بناء كل الشركات: الشهادة اتبطلت وقت التبنّي فمفيش شهادة قديمة
 * ممكن تعيش بعد المسح، والمسح بيتم بنفس هوية الدالة أو المشغّل (ADR-0061 §3 و§4).
 *
 * @param deps     القارئات والمولّد
 * @param ctx      سياق المسار
 * @param incident الحادثة المتبنّاة
 * @param rebuilt  عدد الشركات اللي اتسجّلت
 * @returns هل اتمسحت
 */
async function clearIncident(
  deps: RecoverCommissionRemindersDeps,
  ctx: PassContext,
  incident: RecoveryIncident,
  rebuilt: number,
): Promise<boolean> {
  return deps.clearIncident({
    incidentId: incident.id,
    runId: ctx.runId,
    passId: ctx.passId,
    companiesRebuilt: rebuilt,
    auditId: deps.ids.newId(),
  });
}

/** نتيجة فشل ثابتة: مفيش مسح ولا نشر. */
function failed(
  deps: RecoverCommissionRemindersDeps,
  passId: string,
  reason: string,
  incidentId: string | null = null,
): RecoveryResult {
  deps.logger.warn(
    { reason, passId, code: COMMISSION_REMINDER_ALERT_RECERTIFICATION_FAILED },
    'commission reminder recovery alert',
  );
  deps.logger.warn({ reason, passId }, 'commission reminder recovery pass stopped');
  return { outcome: 'FAILED', passId, companies: 0, rebuilt: 0, incidentId };
}
