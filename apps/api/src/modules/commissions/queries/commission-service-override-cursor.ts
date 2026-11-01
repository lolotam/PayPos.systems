import { commissionPlanDate, id } from '@pospay/contracts';
import { z } from 'zod';

/** سياق المؤشر: الشركة والنشاط والموظفة والفلتر اللي اتطلب بيه — المؤشر ميتنقلش بينهم. */
export interface CommissionServiceOverrideCursorContext {
  readonly companyId: string;
  readonly businessId: string;
  readonly employeeId: string;
  readonly serviceId: string | undefined;
}

/** موضع السطر في الترتيب: الخدمة والوقت الخام بالميكروثانية والمعرّف. */
export interface CommissionServiceOverrideCursorPosition {
  readonly serviceId: string;
  /** وقت الحفظ الخام بتوقيت UTC بالميكروثانية؛ مش وقت الرد بالمللي ثانية. */
  readonly createdAt: string;
  readonly id: string;
}

/** نتيجة فك المؤشر: مفيش، أو مؤشر صالح، أو مؤشر مرفوض. */
export type CommissionServiceOverrideCursorDecode =
  | { readonly kind: 'none' }
  | { readonly kind: 'valid'; readonly position: CommissionServiceOverrideCursorPosition }
  | { readonly kind: 'invalid' };

const VERSION = 1;
// وقت UTC خام بالميكروثانية: الصيغة اللي بيطلعها to_char(...,'US') عن PostgreSQL.
const RAW_MICROSECONDS = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/;

/** تاريخ تقويم حقيقي بلا سنة صفر؛ النص الخام يظل بالميكروثانية ولا يمر عبر Date. */
const cursorPayload = z.strictObject({
  v: z.literal(VERSION),
  c: id,
  b: id,
  e: id,
  f: id.nullable(),
  s: id,
  t: z
    .string()
    .regex(RAW_MICROSECONDS)
    .refine((value) => commissionPlanDate.safeParse(value.slice(0, 10)).success),
  i: id,
});

/**
 * يبني المؤشر الخام للصفحة الجاية: سياق الطلب مع موضع آخر سطر في الترتيب.
 * فلتر UUID يُحفظ بحروف صغيرة، عشان تغيير حالة الحروف لا يغيّر الخدمة المطلوبة.
 *
 * @param context  سياق الطلب (الشركة والنشاط والموظفة والفلتر)
 * @param position موضع آخر سطر في الترتيب
 * @returns مؤشر base64url معروف الشكل
 */
export function encodeCommissionServiceOverrideCursor(
  context: CommissionServiceOverrideCursorContext,
  position: CommissionServiceOverrideCursorPosition,
): string {
  const payload = {
    v: VERSION,
    c: context.companyId,
    b: context.businessId,
    e: context.employeeId,
    f: context.serviceId?.toLowerCase() ?? null,
    s: position.serviceId,
    t: position.createdAt,
    i: position.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * يفك المؤشر ويتأكد إنهCanonical ومربوط بنفس السياق قبل ما يوصل الـ SQL.
 * المؤشر الغريب أو بتاع طلب تاني أو فلتر تاني كله رفض معروف، مش خطأ PostgreSQL؛ اختلاف حالة حروف نفس UUID مش فلتر تاني.
 *
 * @param cursor   المؤشر الوارد من العميل
 * @param context  سياق الطلب الحالي
 * @returns نتيجة الفك: مفيش أو صالح أو مرفوض
 */
export function decodeCommissionServiceOverrideCursor(
  cursor: string | undefined,
  context: CommissionServiceOverrideCursorContext,
): CommissionServiceOverrideCursorDecode {
  if (cursor === undefined) return { kind: 'none' };
  let payload: unknown;
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    // الترميز لازم يكون Canonical: نفس النص لازم يرجّع نفس البايتات.
    if (bytes.toString('base64url') !== cursor) return { kind: 'invalid' };
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { kind: 'invalid' };
  }
  const parsed = cursorPayload.safeParse(payload);
  if (!parsed.success) return { kind: 'invalid' };
  const record = parsed.data;
  // المؤشر تبع طلب تاني أو فلتر تاني: رفض قبل أي SQL.
  if (record['c'] !== context.companyId || record['b'] !== context.businessId) {
    return { kind: 'invalid' };
  }
  if (record['e'] !== context.employeeId) return { kind: 'invalid' };
  if (record.f?.toLowerCase() !== context.serviceId?.toLowerCase()) return { kind: 'invalid' };
  // فلتر خدمة واحدة لا يقبل موضع خدمة أخرى؛ UUID بنفس القيمة يظل صالحاً مع اختلاف حالة الحروف.
  if (record.f !== null && record.s.toLowerCase() !== record.f.toLowerCase()) {
    return { kind: 'invalid' };
  }
  return {
    kind: 'valid',
    position: {
      serviceId: record['s'],
      createdAt: record['t'],
      id: record['i'],
    },
  };
}
