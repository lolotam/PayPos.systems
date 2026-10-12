import { parseMoney } from '@pospay/domain';
import type { SessionDraft } from './session-types.ts';

type DecimalSessionDraft = Omit<SessionDraft, 'price' | 'discount'> & {
  price: string;
  discount: { kind: 'AMOUNT'; amount: string } | { kind: 'PERCENT'; bps: number };
};

/**
 * يحول مبالغ النقل الصحيحة الشكل إلى فلس دون فقد، لتستعمل الكتابتان نفس مدخل القواعد.
 *
 * @param lines البنود ذات مبالغ الدينار بثلاث خانات بعد تحقق شكل الطلب
 * @returns مسودات بالفلس مع ترتيب الموظفات ونسبهن كما أدخلت للتحقق في النطاق
 */
export function sessionDrafts(lines: readonly DecimalSessionDraft[]): SessionDraft[] {
  return lines.map((line) => ({ service_id: line.service_id, price: parseMoney(line.price), performers: line.performers,
    discount: line.discount.kind === 'AMOUNT' ? { kind: 'AMOUNT', amount: parseMoney(line.discount.amount) } : line.discount }));
}
