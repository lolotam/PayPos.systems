import { id } from '@pospay/contracts';
import { z } from 'zod';

/** سياق المؤشر: الشركة والنشاط والفلتر اللي اتطلب بيه — المؤشر ميتنقلش بينهم. */
export interface CommissionBlockedCorrectionCursorContext {
  readonly companyId: string;
  readonly businessId: string;
  readonly status: 'open' | 'resolved' | 'all';
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

const VERSION = 1;
// وقت UTC خام بالميكروثانية: الصيغة اللي بيطلعها to_char(...,'US') عن PostgreSQL.
const RAW_MICROSECONDS = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/;
// شهر حقيقي بنفس قاعدة commissionCorrectionPeriod في العقد؛ السكالار نفسه مش منشور للحد الخارجي.
const REAL_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const STATUSES = ['open', 'resolved', 'all'] as const;

/** شهر حقيقي بلا سنة صفر؛ النص الخام يظل بالميكروثانية ولا يمر عبر Date. */
const cursorPayload = z.strictObject({
  v: z.literal(VERSION),
  c: id,
  b: id,
  s: z.enum(STATUSES),
  t: z
    .string()
    .regex(RAW_MICROSECONDS)
    .refine((value) => REAL_MONTH.test(value.slice(0, 7))),
  i: id,
});

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
    v: VERSION,
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
  const parsed = cursorPayload.safeParse(payload);
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
