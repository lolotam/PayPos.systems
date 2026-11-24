import { assertMoney, MONEY_MAX, moneyToString, parseMoney, type Money } from '@pospay/domain';

import { CommissionStatementPayError } from './errors.ts';

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

const FROZEN_KINDS: ReadonlySet<string> = new Set<string>([
  'COMMISSION',
  'SALE',
  'TIP_CARD',
  'TIP_CASH',
  'CORRECTION',
  'CORRECTION_TIP_CARD',
  'CORRECTION_TIP_CASH',
  'CARRY_COMMISSION',
  'CARRY_TIP_CARD',
  'EMPLOYEE',
]);

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

/** بيتحسب مستحق موظفة من بنودها؛ محرك العمولة بيوفّر القاعدة (computeStatementPayable) والـ domain بيجمّع. */
export type StatementPayableOf = (
  rows: readonly {
    readonly kind: Exclude<FrozenStatementLineKind, 'EMPLOYEE'>;
    readonly amount: string;
  }[],
) => { readonly payable: Money };

/**
 * بيجمّع بنود كل موظفة ويحسب صافي صرفها (قاعدة §9): الجانبان (العمولة وبقشيش الكارت) بيتجمعوا
 * لوحدهم وكل واحد بيتقفل عند صفر لو سالب، وبقشيش الكاش للعلم بس ومش داخل الصافي (D-36).
 * قاعدة المبلغ نفسها بتيجي محقونة من محرك العمولة (computeStatementPayable) عشان تتكتب مرة واحدة،
 * والـ domain هنا بيتولى التجميع وشكل الكشف: بند بنوع مش معروف، أو بند لموظفة من غير صف EMPLOYEE
 * مجمّد، بيكسر شكل الكشف وفلوسه هتضيع بصمت — بيترفض.
 *
 * @param lines     البنود المجمّدة للكشف من معاملة الصرف نفسها
 * @param payableOf حاسبة المستحق المحقونة من محرك العمولة
 * @returns صافي واحد لكل موظفة عندها صف EMPLOYEE مجمّد، بالفلوس
 */
export function frozenEmployeePayables(
  lines: readonly FrozenStatementLine[],
  payableOf: StatementPayableOf,
): Map<string, Money> {
  const grouped = new Map<
    string,
    {
      rows: { kind: Exclude<FrozenStatementLineKind, 'EMPLOYEE'>; amount: string }[];
      employeeRow: boolean;
    }
  >();
  for (const line of lines) {
    if (!FROZEN_KINDS.has(line.kind)) {
      throw new Error(`A frozen statement line has an unknown kind: ${line.kind}`);
    }
    const current = grouped.get(line.employeeId) ?? { rows: [], employeeRow: false };
    if (line.kind === 'EMPLOYEE') current.employeeRow = true;
    else {
      // الفحص فوق بيمنع أي نوع مش من الأنواع العشرة، والفرع ده بيستبعد صف EMPLOYEE،
      // فالنوع هنا واحد من الأنواع التسعة اللي بيدخلوا في حساب المستحق.
      current.rows.push({
        kind: line.kind as Exclude<FrozenStatementLineKind, 'EMPLOYEE'>,
        amount: line.amount,
      });
    }
    grouped.set(line.employeeId, current);
  }
  const payables = new Map<string, Money>();
  for (const [employeeId, group] of grouped) {
    // أي بند لموظفة من غير صف EMPLOYEE مجمّد بيكسر شكل الكشف، وفلوسها هتضيع بصمت — بيترفض.
    if (!group.employeeRow) {
      throw new Error(
        `A frozen statement line belongs to employee ${employeeId} with no frozen EMPLOYEE row`,
      );
    }
    payables.set(employeeId, payableOf(group.rows).payable);
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
 * بيحسب المبلغ اللي هيتخزّن لموظفة واحدة في عمود numeric(14,3)، وبيرفض بخطأ صرف محدد (مش 500) لو الصافي الدقيق
 * أو الصافي بعد تقريب الكاش بيعدّي حد العمود: صافي موظفة واحدة مجموع بنود كتير ممكن يعدّي حد البند الواحد، والتقريب لفوق
 * ممكن يدفع آخر قيمة صالحة لفوق الحد. الرفض بيلغي الصرف كله (المعاملة بتتراجع).
 *
 * @param method طريقة الصرف
 * @param exactPayable صافي الصرف الدقيق بالفلوس
 * @param roundCash دالة تقريب الكاش من محرك العمولة (roundCashPayable)
 * @returns المبلغ المتصرف بالفلوس، جوّه حد العمود
 */
function storablePaidAmount(
  method: StatementPaidMethod,
  exactPayable: Money,
  roundCash: (payableMills: Money) => Money,
): Money {
  if (exactPayable > MONEY_MAX) throw new CommissionStatementPayError('COMMISSION_PAYABLE_TOO_LARGE');
  try {
    return paidAmountForMethod(method, exactPayable, roundCash);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new CommissionStatementPayError('COMMISSION_PAYABLE_TOO_LARGE');
    }
    throw error;
  }
}

/**
 * بيكتب مجموع بالفلوس كنص KWD بثلاث خانات من غير حد numeric(14,3): مجموع الكشف كله ممكن يعدّي حد المبلغ الواحد، وحدّه
 * في العقد (16 خانة صحيحة) والتحقق منه جوّه المعاملة قبل الـ commit.
 *
 * @param mills المجموع بالفلوس، غير سالب
 * @returns المجموع بالدينار كنص بثلاث خانات
 */
export function totalMillsToString(mills: bigint): string {
  return `${mills / 1000n}.${(mills % 1000n).toString().padStart(3, '0')}`;
}

/**
 * بيجمّع المبالغ المتصرفة المخزّنة لكشف مدفوع في مجموع واحد لقارئ النشاط كله، من غير حد الصف الواحد.
 *
 * @param paidAmounts المبالغ المتصرفة كنصوص KWD، كل واحد جوّه حد العمود
 * @returns المجموع بالدينار كنص بثلاث خانات
 */
export function sumPaidAmounts(paidAmounts: readonly string[]): string {
  return totalMillsToString(paidAmounts.reduce((sum, amount) => sum + parseMoney(amount), 0n));
}

/**
 * بيبني صفوف الدفع ومجموعها من صوافي الموظفات وطريقة الصرف: صف لكل موظفة بالصافي الدقيق
 * والمبلغ المتصرف (كل صف جوّه حد العمود، وإلا رفض صرف محدد)، والمجموع بيتجمع من المبالغ المتصرفة ومش بيتقرب
 * تاني (D-19) وبيتكتب من غير حد الصف الواحد.
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
  const paid = [...payables].map(([employeeId, exactPayable]) => ({
    employeeId,
    exactPayable,
    paidAmount: storablePaidAmount(method, exactPayable, roundCash),
  }));
  return {
    rows: paid.map((row) => ({
      employeeId: row.employeeId,
      exactPayable: moneyToString(row.exactPayable),
      paidAmount: moneyToString(row.paidAmount),
    })),
    paidTotal: totalMillsToString(paid.reduce((sum, row) => sum + row.paidAmount, 0n)),
  };
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
