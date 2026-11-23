import { describe, expect, it } from 'vitest';

import { parseCarryKind } from '../carry-kind.ts';
import { collectCarries } from '../estimate-visibility.ts';
import type { IncomingCommissionCarry } from '../period-input-types.ts';
import { buildStatement } from '../statement-builder.ts';
import { at, octoberInput, octoberRows } from './statement-fixtures.ts';

/** مرحّل بنوع مش من النوعين، زي صف كتبه كاتب غلط أو قرأه قارئ من عمود text من غير تحقق. */
function carryOfKind(kind: string): IncomingCommissionCarry {
  const base = at(octoberRows().carries, 0);
  return { ...base, kind: kind as IncomingCommissionCarry['kind'] };
}

describe('the commission carry kind', () => {
  it.each(['COMMISSION', 'TIP_CARD'])('accepts %s', (kind) => {
    expect(parseCarryKind(kind)).toBe(kind);
  });

  it.each(['TIP_CASH', 'commission', ''])('refuses the unknown kind "%s"', (kind) => {
    expect(() => parseCarryKind(kind)).toThrow('Unknown commission carry kind');
  });

  it('sums each known kind on its own, and never treats an unknown kind as a card-tip carry', () => {
    const commission = { ...carryOfKind('COMMISSION'), amount: -5_000n };
    const tipCard = { ...carryOfKind('TIP_CARD'), amount: -2_000n };
    expect(collectCarries(null, [commission, tipCard])).toEqual({
      commission: -5_000n,
      tipCard: -2_000n,
    });
    expect(() => collectCarries(null, [commission, carryOfKind('TIP_CASH')])).toThrow(
      'Unknown commission carry kind',
    );
  });

  it('refuses an unknown kind even for a branch-scoped reader, who is shown no carry', () => {
    const branchScope = new Set(['branch-salmiya']);
    expect(collectCarries(branchScope, [carryOfKind('TIP_CARD')])).toEqual({
      commission: 0n,
      tipCard: 0n,
    });
    expect(() => collectCarries(branchScope, [carryOfKind('TIP_CASH')])).toThrow(
      'Unknown commission carry kind',
    );
  });

  it('refuses to freeze a carry row of an unknown kind', () => {
    const rows = octoberRows();
    const input = octoberInput({ ...rows, carries: [carryOfKind('TIP_CASH')] });
    expect(() => buildStatement(input)).toThrow('Unknown commission carry kind');
  });

  it('freezes each known kind as its own carry row kind', () => {
    const rows = octoberRows();
    const input = octoberInput({
      ...rows,
      carries: [
        carryOfKind('COMMISSION'),
        { ...carryOfKind('TIP_CARD'), sourceStatementId: 's-2' },
      ],
    });
    const kinds = buildStatement(input)
      .rows.filter((row) => row.kind.startsWith('CARRY_'))
      .map((row) => row.kind)
      .sort();
    expect(kinds).toEqual(['CARRY_COMMISSION', 'CARRY_TIP_CARD']);
  });
});
