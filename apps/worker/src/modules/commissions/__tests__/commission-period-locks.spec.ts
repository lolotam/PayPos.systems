import type { Tx } from '@pospay/db';
import { expect, it } from 'vitest';

import { lockCommissionPeriods } from '../persistence/commission-period-locks.ts';

const BUSINESS = '01990000-0000-7000-8000-0000000000b1';

interface StatementRow {
  readonly statementId: string;
  readonly period: string;
  readonly status: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';
}

const STATEMENTS: StatementRow[] = [
  { statementId: '01990000-0000-7000-8000-0000000000d1', period: '2026-10', status: 'DRAFT' },
  { statementId: '01990000-0000-7000-8000-0000000000d2', period: '2026-11', status: 'REVIEWED' },
];

const ids = { newId: () => '01990000-0000-7000-8000-0000000000c1' };

it('carries the statement id of every locked month', async () => {
  let calls = 0;
  const tx = {
    // القفل يسأل مرتين لكل شهر: الإدراج ثم القراءة المقفلة التي ترد بصف الكشف.
    execute: async () => {
      calls += 1;
      if (calls % 2 === 1) return [];
      const row = STATEMENTS[calls / 2 - 1];
      return row === undefined ? [] : [row];
    },
  } as unknown as Tx;

  const locked = await lockCommissionPeriods(tx, {
    businessId: BUSINESS,
    periods: ['2026-11', '2026-10'],
    ids,
  });

  expect(locked).toEqual([
    { period: '2026-10', statementId: '01990000-0000-7000-8000-0000000000d1', status: 'DRAFT' },
    { period: '2026-11', statementId: '01990000-0000-7000-8000-0000000000d2', status: 'REVIEWED' },
  ]);
});
