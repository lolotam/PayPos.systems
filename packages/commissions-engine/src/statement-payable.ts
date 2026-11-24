import { parseMoney } from '@pospay/domain';

import type { StatementRowKind } from './statement-types.ts';

/** صف الكشف بنوعه ومبلغه النصي؛ كفاية لحساب المستحق من الأنواع المجمّدة وحدها (FR-033). */
export interface PayableRow {
  readonly kind: StatementRowKind;
  readonly amount: string;
}

/** مستحق موظفة في كشف، وما بيترحّل منه (§9، CS-Q7، CS-Q29، BR-06). */
export interface StatementPayable {
  /** عمولة + بيع + تصحيحات العمولة والبيع + المرحّل الداخل للعمولة؛ ممكن يكون سالب. */
  readonly commissionSubtotal: bigint;
  /** بقشيش الكارت + تصحيحات بقشيش الكارت + المرحّل الداخل لبقشيش الكارت؛ ممكن يكون سالب. */
  readonly tipSide: bigint;
  /** max(0, commissionSubtotal) + max(0, tipSide)؛ ما بيبقاش سالب أبداً. */
  readonly payable: bigint;
  /** الرصيد السالب للعمولة اللي هيترحّل بالكامل، أو صفر. */
  readonly commissionCarryOut: bigint;
  /** الرصيد السالب لبقشيش الكارت اللي هيترحّل بالكامل، أو صفر؛ ما بيتقاصّش مع العمولة. */
  readonly tipCarryOut: bigint;
}

const COMMISSION_SIDE: ReadonlySet<StatementRowKind> = new Set([
  'COMMISSION',
  'SALE',
  'CORRECTION',
  'CARRY_COMMISSION',
]);
const TIP_SIDE: ReadonlySet<StatementRowKind> = new Set([
  'TIP_CARD',
  'CORRECTION_TIP_CARD',
  'CARRY_TIP_CARD',
]);

/**
 * يحسب مستحق موظفة من صفوفها المجمّدة (§9): الجانبان بيتجمعوا لوحدهم وكل واحد بيتقفل عند صفر،
 * وأي رصيد سالب بيتدفع صفر وبيتحوّل لمرحّل كامل من نوعه؛ العمولة وبقشيش الكارت ما بيتقاصّوش
 * (BR-06). بقشيش الكاش وتصحيحاته وصف EMPLOYEE بيتعرضوا بس وما بيدخلوش (D-36).
 *
 * @param rows صفوف موظفة واحدة من الكشف
 * @returns المستحق والمرحّل الخارج لكل جانب
 */
export function computeStatementPayable(rows: readonly PayableRow[]): StatementPayable {
  let commissionSubtotal = 0n;
  let tipSide = 0n;
  for (const row of rows) {
    if (COMMISSION_SIDE.has(row.kind)) commissionSubtotal += parseMoney(row.amount);
    else if (TIP_SIDE.has(row.kind)) tipSide += parseMoney(row.amount);
  }
  const commissionPaid = commissionSubtotal > 0n ? commissionSubtotal : 0n;
  const tipPaid = tipSide > 0n ? tipSide : 0n;
  return {
    commissionSubtotal,
    tipSide,
    payable: commissionPaid + tipPaid,
    commissionCarryOut: commissionSubtotal < 0n ? commissionSubtotal : 0n,
    tipCarryOut: tipSide < 0n ? tipSide : 0n,
  };
}
