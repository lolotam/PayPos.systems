import {
  computeStatementPayable,
  roundCashPayable,
} from '@pospay/commissions-engine';
import { describe, expect, it } from 'vitest';

import {
  frozenEmployeePayables,
  paidAmountForMethod,
  statementPayments,
  type FrozenStatementLine,
  type StatementPayableOf,
} from '../../../domain/statement-payment.ts';

// مواصفة الاتفاق: قاعدة §9 مكتوبة مرة واحدة في المحرك (computeStatementPayable)، والـ domain
// بيحقنها هي. الاختبارات دي بتثبت إن التجميع مع المحرك الحقيقي بيطلع النتائج الموثقة.
const payableOf: StatementPayableOf = (rows) => computeStatementPayable(rows);

const line = (employeeId: string, kind: string, amount: string): FrozenStatementLine => ({
  employeeId,
  kind,
  amount,
});

describe('the injected engine payable produces the documented §9 result', () => {
  it('commission, sales and corrections make the commission side', () => {
    const payables = frozenEmployeePayables(
      [
        line('e1', 'EMPLOYEE', '0.000'),
        line('e1', 'COMMISSION', '10.000'),
        line('e1', 'SALE', '2.500'),
        line('e1', 'CORRECTION', '-4.000'),
        line('e1', 'CARRY_COMMISSION', '1.000'),
      ],
      payableOf,
    );
    expect(payables.get('e1')).toBe(9_500n);
  });

  it('a negative commission side is closed at zero while a positive tip side is paid (CS-Q7)', () => {
    const payables = frozenEmployeePayables(
      [
        line('e1', 'EMPLOYEE', '0.000'),
        line('e1', 'COMMISSION', '-25.000'),
        line('e1', 'TIP_CARD', '6.000'),
      ],
      payableOf,
    );
    expect(payables.get('e1')).toBe(6_000n);
  });
});

describe('the sides never net each other inside the grouped payable', () => {
  it('the card-tip side closes at zero separately and the sides never net (CS-Q29, BR-06)', () => {
    const payables = frozenEmployeePayables(
      [
        line('e1', 'EMPLOYEE', '0.000'),
        line('e1', 'TIP_CARD', '2.000'),
        line('e1', 'CORRECTION_TIP_CARD', '-10.000'),
        line('e1', 'CARRY_TIP_CARD', '-8.000'),
        line('e1', 'COMMISSION', '0.000'),
      ],
      payableOf,
    );
    expect(payables.get('e1')).toBe(0n);
  });

  it('cash tips and their corrections are shown, never added (D-36)', () => {
    const payables = frozenEmployeePayables(
      [
        line('e1', 'EMPLOYEE', '0.000'),
        line('e1', 'COMMISSION', '5.000'),
        line('e1', 'TIP_CASH', '100.000'),
        line('e1', 'CORRECTION_TIP_CASH', '-40.000'),
      ],
      payableOf,
    );
    expect(payables.get('e1')).toBe(5_000n);
  });

  it('the grouped payable equals the engine payable for two employees', () => {
    const lines = [
      line('e1', 'EMPLOYEE', '0.000'),
      line('e1', 'COMMISSION', '41.003'),
      line('e1', 'TIP_CARD', '2.000'),
      line('e2', 'EMPLOYEE', '0.000'),
      line('e2', 'SALE', '-3.000'),
    ];
    const payables = frozenEmployeePayables(lines, payableOf);
    expect(payables.get('e1')).toBe(43_003n);
    expect(payables.get('e1')).toBe(
      computeStatementPayable([
        { kind: 'COMMISSION', amount: '41.003' },
        { kind: 'TIP_CARD', amount: '2.000' },
      ]).payable,
    );
    expect(payables.get('e2')).toBe(0n);
  });
});

describe('the payment figures with the real engine rounding', () => {
  it('cash rounds the exact payable to the nearest 5 fils and other methods pay it exact', () => {
    expect(paidAmountForMethod('CASH', 41_003n, roundCashPayable)).toBe(41_005n);
    expect(paidAmountForMethod('WITH_SALARY', 41_003n, roundCashPayable)).toBe(41_003n);
    expect(paidAmountForMethod('BANK_TRANSFER', 41_003n, roundCashPayable)).toBe(41_003n);
  });

  it('the paid total is the sum of the rounded rows, never a rounding of the total (D-19)', () => {
    const payables = frozenEmployeePayables(
      [
        line('e1', 'EMPLOYEE', '0.000'),
        line('e1', 'COMMISSION', '41.003'),
        line('e2', 'EMPLOYEE', '0.000'),
        line('e2', 'TIP_CARD', '2.000'),
      ],
      payableOf,
    );
    const payments = statementPayments('CASH', payables, roundCashPayable);
    expect(payments.rows).toEqual([
      { employeeId: 'e1', exactPayable: '41.003', paidAmount: '41.005' },
      { employeeId: 'e2', exactPayable: '2.000', paidAmount: '2.000' },
    ]);
    expect(payments.paidTotal).toBe('43.005');
  });
});
