import {
  COMMISSION_BLOCKED_CORRECTION_CURSOR_VERSION,
  commissionBlockedCorrectionCursorPayload,
  type CommissionBlockedCorrectionStatus,
} from '@pospay/contracts';

/** سياق المؤشر: الشركة والنشاط والفلتر اللي اتطلب بيه — المؤشر ميتنقلش بينهم. */
export interface CommissionBlockedCorrectionCursorContext {
  readonly companyId: string;
  readonly businessId: string;
  readonly status: CommissionBlockedCorrectionStatus;
}

/** موضع الصف في الترتيب: وقت الحفظ الخام بالميكروثانية والمعرّف. */
export interface CommissionBlockedCorrectionCursorPosition {
  /** وقت الحفظ الخام بتوقيت UTC بالميكروثانية؛ مش وقت الرد بالمللي ثانية. */
  readonly createdAt: string;
  readonly id: string;
}

/** نتيجة فك المؤشر: مفيش، أو مؤشر صالح، أو مؤشر مرفوض. */
export type CommissionBlockedCorrectionCursorDecode =
  | { readonly kind: 'none' }
  | { readonly kind: 'valid'; readonly position: CommissionBlockedCorrectionCursorPosition }
  | { readonly kind: 'invalid' };

/**
 * يبني المؤشر الخام للصفحة الجاية: سياق الطلب مع موضع آخر صف في الترتيب.
 *
 * @param context  سياق الطلب (الشركة والنشاط والفلتر)
 * @param position موضع آخر صف في الترتيب
 * @returns مؤشر base64url معروف الشكل
 */
export function encodeCommissionBlockedCorrectionCursor(
  context: CommissionBlockedCorrectionCursorContext,
  position: CommissionBlockedCorrectionCursorPosition,
): string {
  const payload = {
    v: COMMISSION_BLOCKED_CORRECTION_CURSOR_VERSION,
    c: context.companyId,
    b: context.businessId,
    s: context.status,
    t: position.createdAt,
    i: position.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * يفك المؤشر ويتأكد إنه canonical ومربوط بنفس السياق والفلتر قبل أي SQL.
 * المؤشر الغريب أو بتاع طلب تاني أو فلتر تاني كله رفض معروف، مش خطأ PostgreSQL.
 *
 * @param cursor   المؤشر الوارد من العميل
 * @param context  سياق الطلب الحالي
 * @returns نتيجة الفك: مفيش أو صالح أو مرفوض
 */
export function decodeCommissionBlockedCorrectionCursor(
  cursor: string | undefined,
  context: CommissionBlockedCorrectionCursorContext,
): CommissionBlockedCorrectionCursorDecode {
  if (cursor === undefined) return { kind: 'none' };
  let payload: unknown;
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    // الترميز لازم يكون canonical: نفس النص لازم يرجّع نفس البايتات.
    if (bytes.toString('base64url') !== cursor) return { kind: 'invalid' };
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { kind: 'invalid' };
  }
  const parsed = commissionBlockedCorrectionCursorPayload.safeParse(payload);
  if (!parsed.success) return { kind: 'invalid' };
  const record = parsed.data;
  // المؤشر تبع طلب تاني أو فلتر تاني: رفض قبل أي SQL.
  if (
    record['c'] !== context.companyId ||
    record['b'] !== context.businessId ||
    record['s'] !== context.status
  ) {
    return { kind: 'invalid' };
  }
  return {
    kind: 'valid',
    position: { createdAt: record['t'], id: record['i'] },
  };
}
