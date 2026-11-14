import type { CommissionCorrectionKind } from './commission-correction-step.ts';
import type { CommissionTipMethod } from './commission-tip-salary-inputs.ts';

/** بادئة مرجع مصدر البند: نفس المفتاح اللي بيبنيه محرك العمولة لكل بند مسعَّر. */
export const COMMISSION_LINE_SOURCE_PREFIX = 'line:';

/** بادئة مرجع مصدر بيع الباقة: بتظهر مع 50-4 لما إسقاط البيع يوصل. */
export const COMMISSION_SALE_SOURCE_PREFIX = 'sale:';

/** بادئة مرجع مصدر البقشيش: هوية الجلسة ثم طريقة الدفع. */
export const COMMISSION_TIP_SOURCE_PREFIX = 'tip:';

/**
 * يبني مرجع مصدر البند بالشكل الوحيد اللي بتستعمله الصفوف المجمّدة وصفوف التصحيح:
 * البادئة ثم هوية البند، فالمصدر بيتعرف عليه من غير ما يتلخبط مع مصدر تاني بنفس الاسم.
 *
 * @param lineId هوية البند المسعَّر
 * @returns مرجع مصدر البند
 */
export function commissionLineSourceRef(lineId: string): string {
  return `${COMMISSION_LINE_SOURCE_PREFIX}${lineId}`;
}

/**
 * يبني مرجع مصدر البقشيش: هوية الجلسة ثم طريقة الدفع، لأن الكارت والكاش مينفعش
 * يتخلطوا في نفس البقشيش ولكل واحد فيهم مسار دفع مختلف (FR-041).
 *
 * @param sessionId هوية جلسة البقشيش
 * @param method طريقة دفع البقشيش
 * @returns مرجع مصدر البقشيش
 */
export function commissionTipSourceRef(sessionId: string, method: CommissionTipMethod): string {
  return `${COMMISSION_TIP_SOURCE_PREFIX}${sessionId}:${method}`;
}

/**
 * يحدّد نوع المصدر من مرجعه: البادئة بتقول الشكل وطريقة الدفع بتقول النوع.
 * المرجع المجهول بيتعامل على أنه بند، لأن محرك العمولة ما بيسعّرش غير البند والبيع.
 *
 * @param sourceRef مرجع المصدر كما ورد في الصف المجمّد أو في نتيجة التسعير
 * @returns نوع المصدر المقابل للمرجع
 */
export function commissionSourceKind(sourceRef: string): CommissionCorrectionKind {
  if (sourceRef.startsWith(COMMISSION_SALE_SOURCE_PREFIX)) return 'SALE';
  if (sourceRef.startsWith(COMMISSION_TIP_SOURCE_PREFIX)) {
    return sourceRef.endsWith(':CASH') ? 'TIP_CASH' : 'TIP_CARD';
  }
  return 'COMMISSION';
}
