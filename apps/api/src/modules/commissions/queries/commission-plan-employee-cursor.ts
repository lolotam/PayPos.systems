import { COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX, id } from '@pospay/contracts';

/** سياق المؤشر: الشركة والنشاط لتطابق 49-1، والنطاق نفسه بيتحدد بالمسار والحارس وRLS. */
export interface CommissionPlanEmployeeCursorContext {
  readonly companyId: string;
  readonly businessId: string;
}

/** نتيجة فك المؤشر: مفيش، أو موضع ترتيب صالح، أو مؤشر مرفوض. */
export type CommissionPlanEmployeeCursorDecode =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'valid';
      readonly after: { readonly key: string; readonly id: string };
    }
  | { readonly kind: 'invalid' };

const VERSION = 1;

/**
 * يبني مؤشر الصفحة الجاية من موضع الترتيب بالقيمة: مفتاح الاسم المخزّن كما رجع من SQL والمعرّف.
 * الاستعلام بكده ما بيقرأش صف مرساة، فحذف الموظفة أو عدم وجود المعرّف ما بيوقفش القائمة
 * وما بيكشفش فرق بينهم. c وb للتطابق مع 49-1 بس، مش تحكم أمني؛ المسار والحارس وRLS بيحددوا النطاق.
 */
export function encodeCommissionPlanEmployeeCursor(
  context: CommissionPlanEmployeeCursorContext,
  position: { key: string; id: string },
): string {
  const payload = {
    v: VERSION,
    c: context.companyId.toLowerCase(),
    b: context.businessId.toLowerCase(),
    k: position.key,
    i: position.id.toLowerCase(),
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
  if (record['v'] !== VERSION) return null;
  return record;
}

function positionInContext(
  payload: Record<string, unknown>,
  context: CommissionPlanEmployeeCursorContext,
): { key: string; id: string } | null {
  const companyId = id.safeParse(payload['c']);
  if (!companyId.success) return null;
  const businessId = id.safeParse(payload['b']);
  if (!businessId.success) return null;
  const employeeId = id.safeParse(payload['i']);
  if (!employeeId.success) return null;
  if (companyId.data.toLowerCase() !== context.companyId.toLowerCase()) return null;
  if (businessId.data.toLowerCase() !== context.businessId.toLowerCase()) return null;
  const key = payload['k'];
  if (typeof key !== 'string' || key.includes('\u0000')) return null;
  return { key, id: employeeId.data.toLowerCase() };
}

/**
 * يفك المؤشر ويتأكد إنه مربوط بنفس الشركة والنشاط قبل ما يوصل الـ SQL، من غير قراءة صف مرساة.
 * إعادة ترميز الموضع ومقارنته بالنص الأصلي بتثبت الشكل Canonical كامل: أي مفتاح زيادة أو
 * نقصان أو مكرر أو معاد ترتيبه، وأي معرّف بحروف كبيرة، بيرجّع نص مختلف فبيترفض بدل فحص منفصل لكل حالة.
 */
export function decodeCommissionPlanEmployeeCursor(
  cursor: string | undefined,
  context: CommissionPlanEmployeeCursorContext,
): CommissionPlanEmployeeCursorDecode {
  if (cursor === undefined) return { kind: 'none' };
  if (cursor.length > COMMISSION_PLAN_EMPLOYEE_CURSOR_MAX) return { kind: 'invalid' };
  const payload = cursorPayload(cursor);
  if (payload === null) return { kind: 'invalid' };
  const after = positionInContext(payload, context);
  if (after === null) return { kind: 'invalid' };
  if (encodeCommissionPlanEmployeeCursor(context, after) !== cursor) return { kind: 'invalid' };
  return { kind: 'valid', after };
}
