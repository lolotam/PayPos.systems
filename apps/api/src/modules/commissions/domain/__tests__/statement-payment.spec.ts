import { describe, expect, it } from 'vitest';

import type { Money } from '@pospay/domain';

import {
  frozenEmployeePayables,
  paidAmountForMethod,
  paidOnRefusal,
  statementPayments,
  type FrozenStatementLine,
} from '../statement-payment.ts';

// دالة تقريب وهمية بتميّل إضاافتين واضحتين، عشان الاختبار يثبت قاعدة «إمتى يتقرب»
// من غير ما يعتمد على حساب roundCashPayable الحقيقي؛ المحرك بيختبرها بنفسه بالتفصيل.
const doubleRounder = (value: Money): Money => value + value;

const line = (employeeId: string, kind: string, amount: string): FrozenStatementLine => ({
  employeeId,
  kind,
  amount,
});

describe('frozenEmployeePayables', () => {
  it('a statement with frozen rows only pays every employee zero', () => {
    const payables = frozenEmployeePayables([
      line('e1', 'EMPLOYEE', '0.000'),
      line('e2', 'EMPLOYEE', '0.000'),
    ]);
    expect(payables.get('e1')).toBe(0n);
    expect(payables.get('e2')).toBe(0n);
  });

  it('commission, sales and corrections make the commission side', () => {
    const payables = frozenEmployeePayables([
      line('e1', 'EMPLOYEE', '0.000'),
      line('e1', 'COMMISSION', '10.000'),
      line('e1', 'SALE', '2.500'),
      line('e1', 'CORRECTION', '-4.000'),
      line('e1', 'CARRY_COMMISSION', '1.000'),
    ]);
    expect(payables.get('e1')).toBe(9_500n);
  });

  it('a negative commission side is closed at zero while a positive tip side is paid (CS-Q7)', () => {
    const payables = frozenEmployeePayables([
      line('e1', 'EMPLOYEE', '0.000'),
      line('e1', 'COMMISSION', '-25.000'),
      line('e1', 'TIP_CARD', '6.000'),
    ]);
    expect(payables.get('e1')).toBe(6_000n);
  });

  it('the card-tip side is closed at zero separately and the carry never nets the sides (CS-Q29, BR-06)', () => {
    const payables = frozenEmployeePayables([
      line('e1', 'EMPLOYEE', '0.000'),
      line('e1', 'TIP_CARD', '2.000'),
      line('e1', 'CORRECTION_TIP_CARD', '-10.000'),
      line('e1', 'CARRY_TIP_CARD', '-8.000'),
      line('e1', 'COMMISSION', '0.000'),
    ]);
    expect(payables.get('e1')).toBe(0n);
  });

  it('cash tips and their corrections are shown, never added (D-36)', () => {
    const payables = frozenEmployeePayables([
      line('e1', 'EMPLOYEE', '0.000'),
      line('e1', 'COMMISSION', '5.000'),
      line('e1', 'TIP_CASH', '100.000'),
      line('e1', 'CORRECTION_TIP_CASH', '-40.000'),
    ]);
    expect(payables.get('e1')).toBe(5_000n);
  });

  it('a line of an employee with no frozen EMPLOYEE row breaks the statement shape', () => {
    expect(() =>
      frozenEmployeePayables([line('e1', 'COMMISSION', '10.000')]),
    ).toThrow(/no frozen EMPLOYEE row/);
  });

  it('an unknown frozen kind is a broken invariant, never a silently unpaid line', () => {
    expect(() =>
      frozenEmployeePayables([line('e1', 'EMPLOYEE', '0.000'), line('e1', 'BONUS', '5.000')]),
    ).toThrow(/unknown kind/);
  });
});

describe('paidAmountForMethod and statementPayments', () => {
  it('a cash payment goes through the injected rounding and any other method is exact', () => {
    expect(paidAmountForMethod('CASH', 41_003n, doubleRounder)).toBe(82_006n);
    expect(paidAmountForMethod('WITH_SALARY', 41_003n, doubleRounder)).toBe(41_003n);
    expect(paidAmountForMethod('BANK_TRANSFER', 41_003n, doubleRounder)).toBe(41_003n);
  });

  it('the payment rows carry the exact and the paid figures and the total is their plain sum', () => {
    const payables = frozenEmployeePayables([
      line('e1', 'EMPLOYEE', '0.000'),
      line('e1', 'COMMISSION', '41.003'),
      line('e2', 'EMPLOYEE', '0.000'),
      line('e2', 'TIP_CARD', '2.000'),
    ]);
    const payments = statementPayments('CASH', payables, (value) => value);
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
