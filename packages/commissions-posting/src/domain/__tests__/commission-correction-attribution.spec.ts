import { expect, it } from 'vitest';

import {
  resolveSourceAttribution,
  type CommissionAttachmentInterval,
} from '../commission-correction-attribution.ts';

const BRANCH_A = '01990000-0000-7000-8000-0000000000b1';
const BRANCH_B = '01990000-0000-7000-8000-0000000000b2';

const interval = (
  branchId: string,
  attachedFrom: string,
  attachedTo: string | null,
): CommissionAttachmentInterval => ({ branchId, attachedFrom, attachedTo });

it('keeps the source branch and the business date and collects the covering branches', () => {
  const attribution = resolveSourceAttribution({
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-10-15',
    attachments: [interval(BRANCH_A, '2026-10-01', '2026-10-31')],
  });
  expect(attribution).toEqual({
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-10-15',
    attachedBranchIds: [BRANCH_A],
  });
});

it('returns an empty list when no interval covers the business date', () => {
  const attribution = resolveSourceAttribution({
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-10-15',
    attachments: [interval(BRANCH_A, '2026-11-01', '2026-11-30')],
  });
  expect(attribution.attachedBranchIds).toEqual([]);
  expect(attribution.sourceBranchId).toBe(BRANCH_A);
});

it('includes both boundaries of the interval', () => {
  const first = resolveSourceAttribution({
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-10-01',
    attachments: [interval(BRANCH_A, '2026-10-01', '2026-10-31')],
  });
  const last = resolveSourceAttribution({
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-10-31',
    attachments: [interval(BRANCH_A, '2026-10-01', '2026-10-31')],
  });
  expect(first.attachedBranchIds).toEqual([BRANCH_A]);
  expect(last.attachedBranchIds).toEqual([BRANCH_A]);
});

it('excludes a date before the interval and a date after it', () => {
  const before = resolveSourceAttribution({
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-09-30',
    attachments: [interval(BRANCH_A, '2026-10-01', '2026-10-31')],
  });
  const after = resolveSourceAttribution({
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-11-01',
    attachments: [interval(BRANCH_A, '2026-10-01', '2026-10-31')],
  });
  expect(before.attachedBranchIds).toEqual([]);
  expect(after.attachedBranchIds).toEqual([]);
});

it('treats a missing interval end as an open interval', () => {
  const attribution = resolveSourceAttribution({
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-12-31',
    attachments: [interval(BRANCH_A, '2026-10-01', null)],
  });
  expect(attribution.attachedBranchIds).toEqual([BRANCH_A]);
});

it('sorts and dedupes the branches whatever order they arrive in', () => {
  const attribution = resolveSourceAttribution({
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-10-15',
    attachments: [
      interval(BRANCH_B, '2026-10-01', '2026-10-31'),
      interval(BRANCH_A, '2026-10-01', '2026-10-31'),
      interval(BRANCH_B, '2026-10-10', '2026-10-20'),
    ],
  });
  expect(attribution.attachedBranchIds).toEqual([BRANCH_A, BRANCH_B]);
});

it('does not modify the rows it reads', () => {
  const attachments = [interval(BRANCH_A, '2026-10-01', '2026-10-31')];
  resolveSourceAttribution({
    sourceBranchId: BRANCH_A,
    sourceBusinessDate: '2026-10-15',
    attachments,
  });
  expect(attachments).toEqual([
    { branchId: BRANCH_A, attachedFrom: '2026-10-01', attachedTo: '2026-10-31' },
  ]);
});
