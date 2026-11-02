import { id } from '@pospay/contracts';

/** سياق المؤشر: الشركة والنشاط — المؤشر ميتنقلش منهم. */
export interface CommissionPlanEmployeeCursorContext {
  readonly companyId: string;
  readonly businessId: string;
}

/** نتيجة فك المؤشر: مفيش، أو مؤشر صالح، أو مؤشر مرفوض. */
export type CommissionPlanEmployeeCursorDecode =
  | { readonly kind: 'none' }
  | { readonly kind: 'valid'; readonly employeeId: string }
  | { readonly kind: 'invalid' };

const VERSION = 1;
// مفاتيح الحمولة بالظبط: أي مفتاح زيادة أو نقصان مرفوض، عشان المؤشر ما يحملش حالة غريبة.
const PAYLOAD_KEYS = ['v', 'c', 'b', 'i'] as const;

/**
 * يبني المؤشر للصفحة الجاية: الشركة والنشاط ومعرّف آخر موظفة في الترتيب.
 * المعرّفات بتتحفظ بحروف صغيرة، عشان تغيير حالة الحروف ما يغيّرش الموظفة المطلوبة.
 */
export function encodeCommissionPlanEmployeeCursor(
  context: CommissionPlanEmployeeCursorContext,
  employeeId: string,
): string {
  const payload = {
    v: VERSION,
    c: context.companyId.toLowerCase(),
    b: context.businessId.toLowerCase(),
    i: employeeId.toLowerCase(),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function cursorPayload(cursor: string): Record<string, unknown> | null {
  let payload: unknown;
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    // الترميز لازم يكون Canonical: نفس النص لازم يرجّع نفس البايتات.
    if (bytes.toString('base64url') !== cursor) return null;
    payload = JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== PAYLOAD_KEYS.length) return null;
  if (!PAYLOAD_KEYS.every((key) => keys.includes(key))) return null;
  if (record['v'] !== VERSION) return null;
  return record;
}

function employeeIdInContext(
  payload: Record<string, unknown>,
  context: CommissionPlanEmployeeCursorContext,
): string | null {
  const companyId = id.safeParse(payload['c']);
  if (!companyId.success) return null;
  const businessId = id.safeParse(payload['b']);
  if (!businessId.success) return null;
  const employeeId = id.safeParse(payload['i']);
  if (!employeeId.success) return null;
  if (companyId.data.toLowerCase() !== context.companyId.toLowerCase()) return null;
  if (businessId.data.toLowerCase() !== context.businessId.toLowerCase()) return null;
  return employeeId.data.toLowerCase();
}

/**
 * يفك المؤشر ويتأكد إنه Canonical ومربوط بنفس الشركة والنشاط قبل ما يوصل الـ SQL.
 * المؤشر الغريب أو بتاع نشاط تاني كله رفض معروف (VALIDATION_FAILED)، مش خطأ PostgreSQL.
 */
export function decodeCommissionPlanEmployeeCursor(
  cursor: string | undefined,
  context: CommissionPlanEmployeeCursorContext,
): CommissionPlanEmployeeCursorDecode {
  if (cursor === undefined) return { kind: 'none' };
  const payload = cursorPayload(cursor);
  if (payload === null) return { kind: 'invalid' };
  const employeeId = employeeIdInContext(payload, context);
  if (employeeId === null) return { kind: 'invalid' };
  return { kind: 'valid', employeeId };
}
