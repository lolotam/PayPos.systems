import { expect, it } from 'vitest';

import { CommissionBlockNoticeGroupSizeError } from '../errors.ts';
import { groupCommissionBlockNoticeRecipients } from '../commission-block-notice.ts';

const userId = (index: number): string =>
  `01920000-0000-7000-8000-${String(index).padStart(12, '0')}`;

it('N1 splits 250 holders with duplicates into 100, 100 and 50 ascending without duplicates', () => {
  const holders = Array.from({ length: 250 }, (_, index) => userId(index));
  // ترتيب عشوائي وتكرارات: القراءة الفعلية بترجّع مرتبة، والاختبار بيثبت إن التقسيم مستقل عن الاثنين.
  const shuffled = [...holders.slice(1), holders[0] as string, holders[249] as string];
  const groups = groupCommissionBlockNoticeRecipients(shuffled, 100);
  expect(groups.map((group) => group.length)).toEqual([100, 100, 50]);
  expect(groups.flat()).toEqual(holders);
  expect(new Set(groups.flat()).size).toBe(250);
});

it('N1 gives zero holders zero groups', () => {
  expect(groupCommissionBlockNoticeRecipients([], 100)).toEqual([]);
});

it('N1 keeps a full hundred as one group and a hundred and one as a hundred and one remainder', () => {
  const holders = Array.from({ length: 101 }, (_, index) => userId(index));
  expect(groupCommissionBlockNoticeRecipients(holders.slice(0, 100), 100)).toEqual([
    holders.slice(0, 100),
  ]);
  expect(groupCommissionBlockNoticeRecipients(holders, 100).map((group) => group.length)).toEqual([
    100, 1,
  ]);
});

it.each([0, -5, 2.5, Number.NaN])(
  'N1 refuses a group size that is not a positive integer: %s',
  (size) => {
    expect(() => groupCommissionBlockNoticeRecipients([userId(1)], size)).toThrowError(
      CommissionBlockNoticeGroupSizeError,
    );
  },
);
