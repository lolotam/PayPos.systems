import { expect, it } from 'vitest';
import { statementRow } from '../../api/__tests__/statement-http';
import { correctionsTotal } from '../statement-display';
import { sumAmounts } from '../statement-sum';

it.each([
  [[], '0.000'],
  [['1.500', '2.250'], '3.750'],
  [['-6.000', '-4.000'], '-10.000'],
  [['5.000', '-6.250'], '-1.250'],
  [['0.001', '0.002'], '0.003'],
  [['-0.001'], '-0.001'],
])('sums %j to %s in whole mills', (amounts, total) => {
  expect(sumAmounts(amounts)).toBe(total);
});

it('sums valid rows past the single-row money bound, positive and negative', () => {
  const nearBound = '99999999999.999';
  expect(sumAmounts([nearBound, nearBound, '0.002'])).toBe('200000000000.000');
  expect(sumAmounts([`-${nearBound}`, `-${nearBound}`, '-0.002'])).toBe('-200000000000.000');
});

it('shows a corrections total above the single-row bound formatted, instead of failing the screen', () => {
  const rows = [
    statementRow('c:1', 'CORRECTION', '99999999999.999'),
    statementRow('c:2', 'CORRECTION_TIP_CARD', '99999999999.999'),
    statementRow('c:3', 'CORRECTION_TIP_CASH', '5.000'),
  ];
  expect(correctionsTotal(rows)).toBe('199,999,999,999.998');
  const negative = rows.map((row) => ({ ...row, amount: `-${row.amount}` }));
  expect(correctionsTotal(negative)).toBe('-199,999,999,999.998');
});
