const DAY_MS = 86_400_000;

/** حصيلة الفحص التي تسمح بإعادة المحاولة لو فشلت معاملة، دون إعادة تنبيه الوثائق الناجحة. */
export interface ExpiryProgress {
  readonly notified: number;
  readonly failed: number;
}

/**
 * يضم نتيجة معاملة وثيقة لحصيلة الدورة؛ false يعني لا تغيير وnull يعني إعادة المحاولة.
 *
 * @param progress الحصيلة السابقة
 * @param outcome نتيجة المعاملة
 * @returns الحصيلة بعد هذه الوثيقة
 */
export function recordExpiryOutcome(
  progress: ExpiryProgress,
  outcome: boolean | null,
): ExpiryProgress {
  return {
    notified: progress.notified + (outcome === true ? 1 : 0),
    failed: progress.failed + (outcome === null ? 1 : 0),
  };
}

/**
 * تاريخ اليوم بتوقيت النشاط من الساعة المحقونة، فلا يتغير شرط التنبيه مع مكان الخادم.
 * نسخة العامل من قاعدة spec 028 نفسها؛ العامل لا يستورد موديول API staff.
 *
 * @param now اللحظة المحقونة
 * @param timeZone منطقة النشاط المحلولة
 * @returns اليوم المحلي بصيغة YYYY-MM-DD
 */
export function businessToday(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function realDate(value: string): boolean {
  const at = new Date(`${value}T00:00:00Z`);
  return (
    /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(at.getTime()) &&
    at.toISOString().slice(0, 10) === value
  );
}

/**
 * يضيف أياماً مدنية دون الاعتماد على طول اليوم أو التوقيت الصيفي.
 *
 * @param date تاريخ البداية المحلي
 * @param days عدد الأيام (قد يكون سالباً)
 * @returns التاريخ المدني الناتج
 */
export function addExpiryDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * نافذة أيام التنبيه: من اليوم المحلي حتى اليوم زائد أيام تنبيه النوع، شامل الطرفين.
 * صفر أيام يعني يوم الانتهاء نفسه فقط.
 *
 * @param today يوم النشاط المحلي
 * @param alertDays أيام تنبيه النوع الحالية
 * @returns أول وآخر يوم يدخل فيهما date الانتهاء
 */
export function expiryNoticeWindow(today: string, alertDays: number): { from: string; to: string } {
  if (!realDate(today)) throw new Error('DOCUMENT_EXPIRY_TODAY_INVALID');
  if (!Number.isInteger(alertDays) || alertDays < 0 || alertDays > 365)
    throw new Error('DOCUMENT_EXPIRY_ALERT_DAYS_INVALID');
  return { from: today, to: addExpiryDays(today, alertDays) };
}

/**
 * عدد الأيام من اليوم المحلي حتى تاريخ الانتهاء؛ صفر يعني يوم الانتهاء نفسه، وسالب يعني منتهية.
 *
 * @param expiresOn تاريخ الانتهاء أو null
 * @param today يوم النشاط المحلي
 * @returns الأيام المتبقية، أو null بلا تاريخ انتهاء
 */
export function daysUntilExpiry(expiresOn: string | null, today: string): number | null {
  if (expiresOn === null) return null;
  if (!realDate(today) || !realDate(expiresOn)) throw new Error('DOCUMENT_EXPIRY_DATE_INVALID');
  return (Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
}

/**
 * هل تدخل الوثيقة نافذة "تقترب من الانتهاء" اليوم؟ نفس قاعدة spec 028 (DOC-Q5):
 * منتهية أو بلا تاريخ لا تدخل، والانتهاء اليوم أو داخل أيام التنبيه يدخل (0 = يوم الانتهاء).
 *
 * @param expiresOn تاريخ الانتهاء أو null
 * @param alertDays أيام تنبيه النوع الحالية
 * @param today يوم النشاط المحلي
 * @returns true لو وجب إرسال تنبيه انتهاء لها اليوم
 */
export function documentExpiryCandidate(
  expiresOn: string | null,
  alertDays: number,
  today: string,
): boolean {
  const left = daysUntilExpiry(expiresOn, today);
  if (left === null) return false;
  const { from, to } = expiryNoticeWindow(today, alertDays);
  const date = expiresOn as string;
  return date >= from && date <= to;
}
