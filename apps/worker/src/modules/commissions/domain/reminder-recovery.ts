/**
 * استعادة جدولة تذكيرات كشف العمولة (ADR-0061): المفاتيح الثلاثة في Redis، وجدول
 * الفتحات، وشكل السجلات. كل الدوال هنا خالصة، فالمسند نفسه بيت testers من غير Redis.
 */

/** مفتاح الإيجار: «المسار ده يملك الاستعادة». */
export const REMINDER_RECOVERY_KEY = 'commissions:reminders:recovery';
/** مفتاح الشهادة: «الجيل ده اتبنى واتأكد لكل الشركات اللي قبل العتبة». */
export const REMINDER_SENTINEL_KEY = 'commissions:reminders:sentinel';
/** مفتاح الإيقاع: «أنهي فتحة اتجرّبت آخر مرة». */
export const REMINDER_RECOVERY_SLOT_KEY = 'commissions:reminders:recovery-slot';

/** عمر الإيجار بالثواني (ADR-0061 §4). */
export const REMINDER_RECOVERY_LEASE_TTL_SECONDS = 120;
/** أطول فترة بين تجديدين: ثلث عمر الإيجار (ADR-0061 §4 الخطوة 3). */
export const REMINDER_RECOVERY_RENEW_MS = 40_000;
/** مهلة قراءة الصفحة بالميلي ثانية (ADR-0061 §4). */
export const REMINDER_RECOVERY_PAGE_DEADLINE_MS = 30_000;
/** مهلة تسجيل جدولة شركة واحدة بالميلي ثانية (ADR-0061 §4). */
export const REMINDER_RECOVERY_UPSERT_DEADLINE_MS = 10_000;
/** أطول فترة بلا تقدّم قبل إنهاء المسار (ADR-0061 §4). */
export const REMINDER_RECOVERY_MAX_IDLE_MS = 90_000;
/** المهلة الصلبة للمسار كله: الحد الأعلى للقائمة (بند 1 من #1222). */
export const REMINDER_RECOVERY_PASS_DEADLINE_MS = 15 * 60_000;
/** حجم صفحة قائمة الشركات (ADR-0061 §1: الدالة بتقصّ المقاس على مية). */
export const REMINDER_RECOVERY_PAGE_SIZE = 1000;
/** الفاصل بين جولات الفحص الدوري لتغطية الجدولات بالميلي ثانية (ADR-0061 §8، issue #1220). */
export const REMINDER_COVERAGE_SWEEP_INTERVAL_MS = 5 * 60_000;
/** حجم صفحة الفحص الدوري: أصغر من صفحة الاستعادة عشان الجولة الواحدة خفيفة. */
export const REMINDER_COVERAGE_PAGE_SIZE = 200;
/** أقصى عدد صفحات في الجولة الواحدة: السقف الأعلى لتكلفة الجولة مع حجم الصفحة. */
export const REMINDER_COVERAGE_MAX_PAGES = 5;
/** أقصى عدد جدولات تتسجّل في الجولة الواحدة: الباقي ينتظر الجولة الجاية. */
export const REMINDER_COVERAGE_MAX_RESTORES = 100;
/** مهلة كل عملية في الجولة (قراءة صفحة أو فحص وجود أو تسجيل) بالميلي ثانية. */
export const REMINDER_COVERAGE_OPERATION_DEADLINE_MS = 10_000;
/** المهلة الكلية للجولة: بعدها ما بتبدأش صفحة جديدة وبتكمل من نفس المؤشر في الجولة الجاية. */
export const REMINDER_COVERAGE_SWEEP_DEADLINE_MS = 60_000;

/** عمر سجل الإيقاع بالثواني: شبكة أمان (ADR-0061 §4). */
export const REMINDER_RECOVERY_SLOT_TTL_SECONDS = 24 * 60 * 60;

/** جدول الفتحات بالدقائق من المرساة: صفر، واحد، تلاتة، سبعة، خمسة عشر، وكل 15 بعد كده. */
const SLOT_MINUTES = [0, 1, 3, 7] as const;

/** سجل الشهادة: مين نشرها وبأي عتبة وبأي سور تسلسلي. */
export interface ReminderSentinel {
  readonly release: string;
  readonly runId: string;
  readonly passId: string;
  /** وقت PostgreSQL اللي اتقرا في جملة لوحدها قبل القائمة. */
  readonly cutoff: string;
  /** آخر رقم تسلسلي في الأوتبوكس وقت العتبة: السور اللي بيحمي من رجوع الساعة. */
  readonly cutoffSeq: string;
}

/** سجل الإيجار: الحادثة (لو اتعرفت) ومعرّف تشغيل Redis ومعرّف المسار. */
export interface ReminderLease {
  readonly incidentId: string | null;
  readonly runId: string;
  readonly passId: string;
}

/** سجل الإيقاع: الحادثة ومرساة الجدولة وآخر فتحة اتجرّبت. */
export interface ReminderSlot {
  readonly incidentId: string | null;
  /** مرساة الجدولة: وقت رفع الحادثة، أو وقت أول محاولة لتمر بلا حادثة. */
  readonly anchor: string;
  readonly slot: number;
  /** معرّف تشغيل Redis الذي بدأ مسار البداية لمرة واحدة في الجيل (البند 4 من #1222). */
  readonly startupRunId?: string;
  /** مرساة محاولات مسار البداية المستقل عن أي حادثة مقفولة. */
  readonly startupAnchor?: string;
  /** آخر فتحة اتجرّبت في مسار البداية داخل نفس جيل Redis. */
  readonly startupSlot?: number;
}

/**
 * تأخير الفتحة عن المرساة بالميلي ثانية: صفر، دقيقة، تلاتة، سبعة، خمسة عشر، وكل 15 بعد كده.
 *
 * @param slot رقم الفتحة
 * @returns التأخير بالميلي ثانية
 */
export function recoverySlotDelayMs(slot: number): number {
  if (slot <= 0) return 0;
  const fixed = SLOT_MINUTES;
  if (slot < fixed.length) return (fixed[slot] ?? 0) * 60_000;
  return (slot - fixed.length + 1) * 15 * 60_000;
}

/**
 * الفتحة المستحقة الآن منذ المرساة: أكبر رقم فتحة تأخيرها لاقى، أو -1 لو المدة لسه أولها.
 *
 * @param elapsedMs المدة منذ المرساة بالميلي ثانية
 * @returns رقم الفتحة، أو -1
 */
export function dueRecoverySlot(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return -1;
  const fixed = SLOT_MINUTES;
  if (elapsedMs >= 15 * 60_000) {
    return fixed.length - 1 + Math.floor(elapsedMs / (15 * 60_000));
  }
  let due = -1;
  for (let slot = 0; slot < fixed.length; slot += 1) {
    if ((fixed[slot] ?? 0) * 60_000 > elapsedMs) break;
    due = slot;
  }
  return due;
}

/**
 * يقرأ سجل JSON لمفتاح الاستعادة ويتحقق من شكله.
 *
 * @param raw النص المخزّن
 * @returns السجل، أو null لو مش موجود أو مش بالشكل
 */
export function parseReminderSentinel(raw: string | null): ReminderSentinel | null {
  if (raw === null) return null;
  const parsed = parseJson(raw);
  if (parsed === null) return null;
  const { release, run_id: runId, pass_id: passId, cutoff, cutoff_seq: cutoffSeq } = parsed;
  if (typeof release !== 'string' || typeof runId !== 'string') return null;
  if (typeof passId !== 'string' || typeof cutoff !== 'string') return null;
  if (typeof cutoffSeq !== 'string' && typeof cutoffSeq !== 'number') return null;
  return { release, runId, passId, cutoff, cutoffSeq: String(cutoffSeq) };
}

/**
 * يقرأ سجل JSON لمفتاح الإيجار ويتحقق من شكله.
 *
 * @param raw النص المخزّن
 * @returns السجل، أو null
 */
export function parseReminderLease(raw: string | null): ReminderLease | null {
  if (raw === null) return null;
  const parsed = parseJson(raw);
  if (parsed === null) return null;
  const { incident_id: incidentId, run_id: runId, pass_id: passId } = parsed;
  if (typeof runId !== 'string' || typeof passId !== 'string') return null;
  if (incidentId !== null && typeof incidentId !== 'string') return null;
  return { incidentId, runId, passId };
}

/**
 * يقرأ سجل JSON لمفتاح الإيقاع ويتحقق من شكله.
 *
 * @param raw النص المخزّن
 * @returns السجل، أو null
 */
export function parseReminderSlot(raw: string | null): ReminderSlot | null {
  if (raw === null) return null;
  const parsed = parseJson(raw);
  if (parsed === null) return null;
  const {
    incident_id: incidentId,
    anchor,
    slot,
    startup_run_id: startupRunId,
    startup_anchor: startupAnchor,
    startup_slot: startupSlot,
  } = parsed;
  if (typeof anchor !== 'string' || typeof slot !== 'number') return null;
  if (incidentId !== null && typeof incidentId !== 'string') return null;
  return {
    incidentId,
    anchor,
    slot,
    ...(typeof startupRunId === 'string' ? { startupRunId } : {}),
    ...(typeof startupAnchor === 'string' ? { startupAnchor } : {}),
    ...(typeof startupSlot === 'number' ? { startupSlot } : {}),
  };
}

/**
 * يقرأ نص JSON ويرجع null لو مش قابل للقراءة.
 *
 * @param raw النص المخزّن
 * @returns السجل ككائن، أو null
 */
function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
