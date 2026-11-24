import type { IncomingCommissionCarry } from './period-input-types.ts';

/**
 * يتحقق من نوع المرحّل المقروء: `COMMISSION` (رصيد العمولة) أو `TIP_CARD` (رصيد بقشيش الكارت)،
 * وغير كده بيرمي بدل ما النوع الغريب يتحسب صامت كبقشيش كارت. الحاجز الأول هو قيد قاعدة البيانات
 * `commission_carries_kind` (spec §6) اللي بيرفض أي نوع تاني وقت الإدراج؛ المحلل ده فحص القراءة
 * اللي وراه، لأي قيمة توصل للمحرّك من مصدر تاني غير الجدول. النوعان ما بيتقاصّوش أبداً (BR-06).
 *
 * @param value نوع المرحّل كما اتخزن
 * @returns النوع نفسه بعد التحقق
 */
export function parseCarryKind(value: string): IncomingCommissionCarry['kind'] {
  if (value === 'COMMISSION' || value === 'TIP_CARD') return value;
  throw new RangeError(`Unknown commission carry kind: ${value}`);
}
