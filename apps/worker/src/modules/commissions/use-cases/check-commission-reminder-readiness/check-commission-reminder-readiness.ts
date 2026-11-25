import type {
  CommissionReminderSchedule,
  ReminderRecoveryReaders,
  ReminderRecoveryStore,
} from '../../ports/reminder-recovery.port.ts';

/** سبب عدم الجاهزية: كود ثابت يفهمه المشغّل من غير تفاصيل. */
export type ReadinessFailure =
  | 'SENTINEL_MISSING'
  | 'SENTINEL_RUN_ID_CHANGED'
  | 'RECOVERY_IN_PROGRESS'
  | 'OPEN_INCIDENT'
  | 'PARKED_OVERFLOW'
  | 'CLOCK_REGRESSION'
  | 'CERTIFICATE_CHANGED'
  | 'SCHEDULER_MISSING'
  | 'FLAG_APPEARED'
  | 'PARKED_SET_CHANGED';

/** نتيجة فحص الجاهزية. */
export interface ReadinessResult {
  readonly ready: boolean;
  readonly reason: ReadinessFailure | null;
}

/** كل ما الفحص يحتاجه: قارئ المرسّل ومتجر Redis والجدولة. */
export interface CheckCommissionReminderReadinessDeps {
  readonly database: ReminderRecoveryReaders;
  readonly store: ReminderRecoveryStore;
  readonly schedule: CommissionReminderSchedule;
}

/** نتيجة القراءة في PostgreSQL: الأعلام المفتوحة والشركات الموقوفة. */
interface DatabaseSnapshot {
  readonly openFlags: number;
  readonly parkedCompanies: readonly string[];
  readonly overflow: boolean;
  readonly clockRegressed: boolean;
}

/**
 * فحص جاهزية استعادة جدولة التذكيرات (ADR-0061 §4 والبند 3 و9 من #1222).
 *
 * أربع خطوات مرتبة: لقطة Redis ذرّية، ثم قراءة PostgreSQL، ثم لقطة Redis ذرّية تانية
 * مع وجود جدولات الشركات الموقوفة، ثم قراءة PostgreSQL تانية تحصر الخطوة الأولى.
 * الجاهزية ما بتضعفش عن الاستعادة: الفحص بيرفض بنفس الأسباب اللي بيقبلها المسار، ومفيش
 * حالة بتخلي `/ready` أخف من الحالات اللي الاستعادة بتبلّغ عنها.
 *
 * @param deps القارئات والمتجر والجدولة
 * @returns نتيجة الجاهزية
 */
export async function checkCommissionReminderReadiness(
  deps: CheckCommissionReminderReadinessDeps,
): Promise<ReadinessResult> {
  const first = await deps.store.snapshot();
  if (first.sentinel === null) return notReady('SENTINEL_MISSING');
  if (first.serverRunId === null || first.sentinel.runId !== first.serverRunId) {
    return notReady('SENTINEL_RUN_ID_CHANGED');
  }
  if (first.lease !== null) return notReady('RECOVERY_IN_PROGRESS');
  const middle = await readDatabase(deps.database, first.sentinel.cutoff, first.sentinel.cutoffSeq);
  if (middle.openFlags > 0) return notReady('OPEN_INCIDENT');
  if (middle.overflow) return notReady('PARKED_OVERFLOW');
  if (middle.clockRegressed) return notReady('CLOCK_REGRESSION');
  const second = await deps.store.probe(deps.schedule.schedulerKeys(middle.parkedCompanies));
  if (second.lease !== null) return notReady('RECOVERY_IN_PROGRESS');
  if (second.serverRunId !== first.serverRunId) return notReady('CERTIFICATE_CHANGED');
  if (
    second.sentinel === null ||
    second.sentinel.passId !== first.sentinel.passId ||
    second.sentinel.runId !== first.sentinel.runId
  ) {
    return notReady('CERTIFICATE_CHANGED');
  }
  if (second.schedulers.some((exists) => exists !== true)) return notReady('SCHEDULER_MISSING');
  const last = await readDatabase(deps.database, first.sentinel.cutoff, first.sentinel.cutoffSeq);
  if (last.openFlags > 0) return notReady('FLAG_APPEARED');
  if (last.clockRegressed) return notReady('CLOCK_REGRESSION');
  if (last.overflow !== middle.overflow) return notReady('PARKED_SET_CHANGED');
  if (last.parkedCompanies.join(',') !== middle.parkedCompanies.join(',')) {
    return notReady('PARKED_SET_CHANGED');
  }
  return { ready: true, reason: null };
}

/**
 * يقرأ PostgreSQL في معاملتين: الأعلام المفتوحة من كل الأكواد، والشركات الموقوفة بعد
 * عتبة الشهادة مع سور الرقم التسلسلي (السور بيحمي من رجوع الساعة).
 *
 * @param database  قارئ المرسّل
 * @param cutoff    عتبة الشهادة
 * @param cutoffSeq سور الرقم التسلسلي وقت العتبة
 * @returns نتيجة القراءة
 */
async function readDatabase(
  database: ReminderRecoveryReaders,
  cutoff: string,
  cutoffSeq: string,
): Promise<DatabaseSnapshot> {
  const flags = await database.openRecoveryFlags();
  const parked = await database.parkedCompanyCreatedAfter(new Date(cutoff), cutoffSeq);
  const cutoffMs = new Date(cutoff).getTime();
  return {
    openFlags: flags.length,
    parkedCompanies: parked.companyIds,
    overflow: parked.overflow,
    clockRegressed: cutoffMs > 0 && parked.dbNow.getTime() < cutoffMs,
  };
}

/** نتيجة غير جاهزة مع السبب الثابت. */
function notReady(reason: ReadinessFailure): ReadinessResult {
  return { ready: false, reason };
}
