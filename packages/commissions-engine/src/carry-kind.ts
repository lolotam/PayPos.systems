import type { IncomingCommissionCarry } from './period-input-types.ts';

/**
 * يتحقق من نوع المرحّل المقروء: `COMMISSION` (رصيد العمولة) أو `TIP_CARD` (رصيد بقشيش الكارت)،
 * وغير كده بيرمي بدل ما النوع الغريب يتحسب صامت كبقشيش كارت. الجدول مالوش CHECK على النوع (spec §6)،
 * فالتحقق هنا هو الحاجز، والنوعان ما بيتقاصّوش أبداً (BR-06).
 *
 * @param value نوع المرحّل كما اتخزن
 * @returns النوع نفسه بعد التحقق
 */
export function parseCarryKind(value: string): IncomingCommissionCarry['kind'] {
  if (value === 'COMMISSION' || value === 'TIP_CARD') return value;
  throw new RangeError(`Unknown commission carry kind: ${value}`);
}
