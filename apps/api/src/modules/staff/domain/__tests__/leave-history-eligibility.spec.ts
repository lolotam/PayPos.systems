import { describe, expect, it } from 'vitest';
import { historyEligible } from '../leave-history-eligibility.ts';

const days = [{ branchId: 'readable', today: '2026-11-08' }];
const attachment = (to: string | null, branch_id = 'readable', from = '2026-01-01') => ({
  branch_id,
  from,
  to,
});

describe('leave history eligibility without infrastructure', () => {
  it.each([
    ['2026-11-07', false],
    ['2026-11-08', false],
    ['2026-11-09', true],
    [null, true],
  ] as const)('uses an exclusive end boundary: %s', (to, expected) => {
    expect(historyEligible({ attachments: [attachment(to)] }, days)).toBe(expected);
  });

  it('does not require the attachment to have started', () => {
    expect(
      historyEligible({ attachments: [attachment(null, 'readable', '2027-01-01')] }, days),
    ).toBe(true);
  });

  it('fails closed for a missing employee, attachments or matching readable day', () => {
    expect(historyEligible(null, days)).toBe(false);
    expect(historyEligible({ attachments: [] }, days)).toBe(false);
    expect(historyEligible({ attachments: [attachment(null)] }, [])).toBe(false);
    expect(historyEligible({ attachments: [attachment(null, 'unreadable')] }, days)).toBe(false);
  });

  it('does not let an unreadable unended attachment rescue an ended readable one', () => {
    const attachments = [attachment('2026-11-08'), attachment(null, 'unreadable')];
    expect(historyEligible({ attachments }, days)).toBe(false);
    expect(historyEligible({ attachments: [...attachments, attachment('2026-11-09')] }, days)).toBe(
      true,
    );
  });

  it('compares each attachment with its own supplied branch day', () => {
    const branchDays = [...days, { branchId: 'yesterday', today: '2026-11-07' }];
    expect(historyEligible({ attachments: [attachment('2026-11-08')] }, branchDays)).toBe(false);
    expect(
      historyEligible({ attachments: [attachment('2026-11-08', 'yesterday')] }, branchDays),
    ).toBe(true);
  });
});
