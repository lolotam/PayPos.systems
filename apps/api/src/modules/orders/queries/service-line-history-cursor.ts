import { SessionDayReadError, type SessionDayScope } from './branch-day-service-sessions.query.ts';

/** نطاق قراءة سجل تعديلات سطر الخدمة: الشركة والنشاط والفرع والزيارة والسطر. */
export interface ServiceLineHistoryScope extends SessionDayScope {
  sessionId: string;
  lineId: string;
}

/**
 * يبني نطاق المؤشر المشترك بين سجل تعديل الأسعار وسجل تغيير المنفّذين للسطر الواحد.
 *
 * @param scope نطاق الزيارة والسطر الحاليين
 * @returns كائن ربط المؤشر بالنطاق
 */
export function lineHistoryCursorScope(scope: ServiceLineHistoryScope) {
  return {
    v: 1 as const,
    company: scope.companyId,
    business: scope.businessId,
    branch: scope.branchId,
    session: scope.sessionId,
    line: scope.lineId,
  };
}

/**
 * يفك مؤشر صفحة سجل السطر ويتحقق من مطابقة الإصدار والنطاق قبل أي قراءة من القاعدة.
 *
 * @param scope نطاق الزيارة والسطر المتوقعين
 * @param raw المؤشر الخام من استعلام الطلب
 * @param parse محلل عقد المؤشر الخاص بالسجل المطلوب
 * @returns المؤشر المفكوك أو null عند غياب المؤشر، ويرمي VALIDATION_FAILED عند العبث
 */
export function decodeLineHistoryCursor<
  T extends { company: string; business: string; branch: string; session: string; line: string },
>(scope: ServiceLineHistoryScope, raw: string | undefined, parse: (input: unknown) => T): T | null {
  if (raw === undefined) return null;
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error();
    const cursor = parse(JSON.parse(bytes.toString('utf8')));
    const expected = lineHistoryCursorScope(scope);
    if (
      cursor.company === expected.company &&
      cursor.business === expected.business &&
      cursor.branch === expected.branch &&
      cursor.session === expected.session &&
      cursor.line === expected.line
    ) {
      return cursor;
    }
  } catch {
    /* بيانات المؤشر لا تدخل التشخيصات. */
  }
  throw new SessionDayReadError('VALIDATION_FAILED');
}

/**
 * يرمّز مؤشر الصفحة التالية لسجل السطر بآخر مراجعة ظاهر في الصفحة الحالية.
 *
 * @param scope نطاق الزيارة والسطر الحاليين
 * @param revision رقم المراجعة الذي يتوقف قبله الطلب التالي
 * @returns مؤشر base64url جاهز للإرجاع
 */
export function encodeLineHistoryCursor(scope: ServiceLineHistoryScope, revision: number): string {
  return Buffer.from(JSON.stringify({ ...lineHistoryCursorScope(scope), revision })).toString('base64url');
}
