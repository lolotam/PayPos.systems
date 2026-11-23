import { describe, expect, it } from 'vitest';

import { parseMoney, sumMoney, type Money } from '@pospay/domain';

import {
  frozenEmployeePayables,
  paidAmountForMethod,
  paidOnRefusal,
  statementPayments,
  type FrozenStatementLine,
  type StatementPayableOf,
} from '../statement-payment.ts';

// حاسبة مستحق وهمية بتجمع مبالغ الصفوف كما هي: المواصفة دي بتفحص التجميع وشكل الكشف بس،
// وقاعدة المبلغ نفسها (§9) بتتفحص مع المحرك الحقيقي في مواصفة الاتفاق عند حالة الاستخدام.
const stubPayableOf: StatementPayableOf = (rows) => ({
  payable: sumMoney(rows.map((row) => parseMoney(row.amount))),
});

// دالة تقريب وهمية بتميّل إضافتين واضحتين، عشان الاختبار يثبت قاعدة «إمتى يتقرّب»
// من غير ما يعتمد على حساب roundCashPayable الحقيقي؛ المحرك بيختبرها بنفسه بالتفصيل.
function doubleRounder(value: Money): Money {
  return value + value;
}

const line = (employeeId: string, kind: string, amount: string): FrozenStatementLine => ({
  employeeId,
  kind,
  amount,
});

describe('frozenEmployeePayables grouping', () => {
  it('groups every employee behind her frozen EMPLOYEE row', () => {
    const payables = frozenEmployeePayables(
      [
        line('e1', 'EMPLOYEE', '0.000'),
        line('e1', 'COMMISSION', '10.000'),
        line('e2', 'EMPLOYEE', '0.000'),
        line('e2', 'SALE', '2.500'),
      ],
      stubPayableOf,
    );
    expect(payables.get('e1')).toBe(10_000n);
    expect(payables.get('e2')).toBe(2_500n);
  });

  it('an employee with a frozen row and no other lines pays zero', () => {
    const payables = frozenEmployeePayables([line('e1', 'EMPLOYEE', '0.000')], stubPayableOf);
    expect(payables.get('e1')).toBe(0n);
  });

  it('a line of an employee with no frozen EMPLOYEE row breaks the statement shape', () => {
    expect(() =>
      frozenEmployeePayables([line('e1', 'COMMISSION', '10.000')], stubPayableOf),
    ).toThrow(/no frozen EMPLOYEE row/);
  });

  it('an unknown frozen kind is a broken invariant, never a silently unpaid line', () => {
    expect(() =>
      frozenEmployeePayables(
        [line('e1', 'EMPLOYEE', '0.000'), line('e1', 'BONUS', '5.000')],
        stubPayableOf,
      ),
    ).toThrow(/unknown kind/);
  });
});

describe('paidAmountForMethod and statementPayments', () => {
  it('a cash payment goes through the injected rounding and any other method is exact', () => {
    expect(paidAmountForMethod('CASH', 41_003n, doubleRounder)).toBe(82_006n);
    expect(paidAmountForMethod('WITH_SALARY', 41_003n, doubleRounder)).toBe(41_003n);
    expect(paidAmountForMethod('BANK_TRANSFER', 41_003n, doubleRounder)).toBe(41_003n);
  });

  it('the payment rows carry the exact and the paid figures as KWD strings', () => {
    const payments = statementPayments(
      'WITH_SALARY',
      new Map<string, Money>([['e1', 41_003n], ['e2', 2_000n]]),
      doubleRounder,
    );
    expect(payments.rows).toEqual([
      { employeeId: 'e1', exactPayable: '41.003', paidAmount: '41.003' },
      { employeeId: 'e2', exactPayable: '2.000', paidAmount: '2.000' },
    ]);
    expect(payments.paidTotal).toBe('43.003');
  });

  it('the paid total is the sum of the paid amounts, never a rounding of the total (D-19)', () => {
    const payables = new Map<string, Money>([
      ['e1', 1n],
      ['e2', 1n],
      ['e3', 1n],
      ['e4', 1n],
      ['e5', 1n],
    ]);
    // التقريب الوهمي هنا بيرجّع المدخل زائد 4 فلوس، والمجموع بيفضل مجموع المبالغ المتصرفة.
    const payments = statementPayments('CASH', payables, (value) => value + 4n);
    expect(payments.rows.map((row) => row.paidAmount)).toEqual([
      '0.005',
      '0.005',
      '0.005',
      '0.005',
      '0.005',
    ]);
    expect(payments.paidTotal).toBe('0.025');
  });
});

describe('paidOnRefusal', () => {
  it('accepts the approval date, any later date, and today itself', () => {
    expect(paidOnRefusal('2026-11-02', '2026-11-02', '2026-11-07')).toBeNull();
    expect(paidOnRefusal('2026-11-07', '2026-11-02', '2026-11-07')).toBeNull();
  });

  it('refuses a date before the approval date and a date after today (FR-037)', () => {
    expect(paidOnRefusal('2026-11-01', '2026-11-02', '2026-11-07')).toBe(
      'COMMISSION_PAID_ON_INVALID',
    );
    expect(paidOnRefusal('2026-11-08', '2026-11-02', '2026-11-07')).toBe(
      'COMMISSION_PAID_ON_INVALID',
    );
  });
});
