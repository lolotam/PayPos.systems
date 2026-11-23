import { assertMoney, moneyToString, parseMoney, sumMoney, type Money } from '@pospay/domain';

/** أنواع البنود المجمّدة في كشف الشهر؛ نفس قائمة kind في قاعدة البيانات (spec 059 §4). */
export type FrozenStatementLineKind =
  | 'COMMISSION'
  | 'SALE'
  | 'TIP_CARD'
  | 'TIP_CASH'
  | 'CORRECTION'
  | 'CORRECTION_TIP_CARD'
  | 'CORRECTION_TIP_CASH'
  | 'CARRY_COMMISSION'
  | 'CARRY_TIP_CARD'
  | 'EMPLOYEE';

/** بند مجمّد واحد بيدخل في حساب صافي صاحبه: هوية الموظفة ونوع البند ومبلغه كنص numeric. */
export interface FrozenStatementLine {
  readonly employeeId: string;
  readonly kind: string;
  readonly amount: string;
}

/** طرق الصرف الثلاثة من قرار CS-Q6. */
export type StatementPaidMethod = 'WITH_SALARY' | 'BANK_TRANSFER' | 'CASH';

/** صف دفع موظفة واحدة جاهز للكتابة والرد؛ المبالغ نصوص KWD بثلاث خانات (D-19). */
export interface StatementPaymentRow {
  readonly employeeId: string;
  readonly exactPayable: string;
  readonly paidAmount: string;
}

/** مجموع المبالغ المتصرف فعلاً لكل موظفات الكشف؛ مجموع الصفوف مش تقريب للمجموع (D-19). */
export interface StatementPayments {
  readonly rows: readonly StatementPaymentRow[];
  readonly paidTotal: string;
}

const COMMISSION_SIDE: ReadonlySet<string> = new Set([
  'COMMISSION',
  'SALE',
  'CORRECTION',
  'CARRY_COMMISSION',
]);
const CARD_TIP_SIDE: ReadonlySet<string> = new Set([
  'TIP_CARD',
  'CORRECTION_TIP_CARD',
  'CARRY_TIP_CARD',
]);
const INFORMATIONAL_SIDE: ReadonlySet<string> = new Set(['TIP_CASH', 'CORRECTION_TIP_CASH']);

/**
 * الجانب السالب بيتقفل عند صفر (CS-Q7 وCS-Q29)؛ الصافي ما بياخدش سالب.
 *
 * @param value المبلغ بالفلوس
 * @returns المبلغ نفسه لو صفر أو أكتر، وصفر لو سالب
 */
function nonNegative(value: Money): Money {
  return value < 0n ? 0n : value;
}

/**
 * بيحسب صافي صرف كل موظفة من بنودها المجمّدة (قاعدة §9): جانب العمولة (عمولة + بيع + تصحيحات +
 * أرصدة مرحّلة) وجانب بقشيش الكارت (بقشيش كارت + تصحيحاته + رصيده المرحّل) كل واحد بيتقفل عند صفر
 * لو طلع سالب، ومجموعهم هو الصافي؛ وبقشيش الكاش للعلم بس ومش داخل الصافي (D-36).
 * الموظفة اللي مالهاش صف EMPLOYEE مجمّد مش هتاخد صف دفع، فأي بند تاني ليها بيكسر شكل الكشف
 * وبيترفض — الفلوس ما تضيعش بصمت جوه كشف معتمد.
 *
 * @param lines البنود المجمّدة للكشف من معاملة الصرف نفسها
 * @returns صافي واحد لكل موظفة عندها صف EMPLOYEE مجمّد، بالفلوس
 */
export function frozenEmployeePayables(
  lines: readonly FrozenStatementLine[],
): Map<string, Money> {
  const sides = new Map<string, { commission: Money[]; cardTips: Money[]; employeeRow: boolean }>();
  for (const line of lines) {
    const amount = parseMoney(line.amount);
    if (
      line.kind !== 'EMPLOYEE' &&
      !COMMISSION_SIDE.has(line.kind) &&
      !CARD_TIP_SIDE.has(line.kind) &&
      !INFORMATIONAL_SIDE.has(line.kind)
    ) {
      throw new Error(`A frozen statement line has an unknown kind: ${line.kind}`);
    }
    const current = sides.get(line.employeeId) ?? {
      commission: [],
      cardTips: [],
      employeeRow: false,
    };
    if (line.kind === 'EMPLOYEE') {
      current.employeeRow = true;
    } else if (COMMISSION_SIDE.has(line.kind)) {
      current.commission.push(amount);
    } else if (CARD_TIP_SIDE.has(line.kind)) {
      current.cardTips.push(amount);
    }
    sides.set(line.employeeId, current);
  }
  const payables = new Map<string, Money>();
  for (const [employeeId, side] of sides) {
    // أي بند لموظفة من غير صف EMPLOYEE مجمّد بيكسر شكل الكشف، وفلوسها هتضيع بصمت — بيترفض.
    if (!side.employeeRow) {
      throw new Error(
        `A frozen statement line belongs to employee ${employeeId} with no frozen EMPLOYEE row`,
      );
    }
    payables.set(
      employeeId,
      sumMoney([nonNegative(sumMoney(side.commission)), nonNegative(sumMoney(side.cardTips))]),
    );
  }
  return payables;
}

/**
 * بيحوّل صافي الموظفة للمبلغ اللي يتصرف فعلاً: كاش بيتقرّب لأقرب 5 فلوس بنص لفوق (CS-Q12، D-19)،
 * وأي طريقة تانية بتتصرف بالصافي الدقيق من غير تقريب. التقريب نفسه بيجي محقون من محرك العمولة
 * عشان domain/ ما تستوردش حزم تانية، والقاعدة هنا بس هي «إمتى يتقرّب».
 *
 * @param method طريقة الصرف
 * @param exactPayable صافي الصرف الدقيق بالفلوس
 * @param roundCash دالة تقريب الكاش من محرك العمولة (roundCashPayable)
 * @returns المبلغ المتصرف بالفلوس
 */
export function paidAmountForMethod(
  method: StatementPaidMethod,
  exactPayable: Money,
  roundCash: (payableMills: Money) => Money,
): Money {
  return method === 'CASH' ? roundCash(assertMoney(exactPayable)) : assertMoney(exactPayable);
}

/**
 * بيبني صفوف الدفع ومجموعها من صوافي الموظفات وطريقة الصرف: صف لكل موظفة بالصافي الدقيق
 * والمبلغ المتصرف، والمجموع بيتجمع من المبالغ المتصرفة ومش بيتقرب تاني (D-19).
 *
 * @param method طريقة الصرف
 * @param payables صافي كل موظفة مجمّدة بالفلوس
 * @param roundCash دالة تقريب الكاش من محرك العمولة (roundCashPayable)
 * @returns الصفوف نصوص KWD والمجموع
 */
export function statementPayments(
  method: StatementPaidMethod,
  payables: ReadonlyMap<string, Money>,
  roundCash: (payableMills: Money) => Money,
): StatementPayments {
  const rows = [...payables].map(([employeeId, exactPayable]) => ({
    employeeId,
    exactPayable: moneyToString(exactPayable),
    paidAmount: moneyToString(paidAmountForMethod(method, exactPayable, roundCash)),
  }));
  const paidTotal = moneyToString(
    sumMoney(rows.map((row) => parseMoney(row.paidAmount))),
  );
  return { rows, paidTotal };
}

/**
 * بيرفض تاريخ الصرف اللي بره نافذة FR-037: مش قبل تاريخ الاعتماد ومش بعد النهارده،
 * والمقارنة على التواريخ المحلية للنشاط كنصوص YYYY-MM-DD.
 *
 * @param paidOn تاريخ الصرف اللي بيصرّحه الدافع
 * @param approvedOn تاريخ الاعتماد على تقويم النشاط
 * @param today النهارده على تقويم النشاط
 * @returns كود الرفض، أو null لما التاريخ داخل النافذة
 */
export function paidOnRefusal(
  paidOn: string,
  approvedOn: string,
  today: string,
): 'COMMISSION_PAID_ON_INVALID' | null {
  return paidOn < approvedOn || paidOn > today ? 'COMMISSION_PAID_ON_INVALID' : null;
}
