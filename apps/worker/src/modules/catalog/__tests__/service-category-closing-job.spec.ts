import { SERVICE_CATEGORY_CLOSING_FAILURE_CODES } from '@pospay/contracts';
import { expect, it } from 'vitest';

import {
  decideServiceCategoryClosing,
  decideServiceCategoryClosingCount,
  SERVICE_CATEGORY_CLOSING_FAILURES,
  type LockedServiceCategory,
  type ServiceCategoryClosingJob,
} from '../domain/service-category-closing-job.ts';

const NOW = new Date('2026-11-14T10:00:00.000Z');
const DEADLINE = new Date('2026-11-14T10:15:00.000Z');
const PAST = new Date('2026-11-14T09:00:00.000Z');

const job = (overrides: Partial<ServiceCategoryClosingJob> = {}): ServiceCategoryClosingJob => ({
  action: 'close',
  status: 'pending',
  expectedRevision: 7,
  expectedServiceCount: 301,
  deadlineAt: DEADLINE,
  ...overrides,
});

const openCategory: LockedServiceCategory = { revision: 7, closedAt: null };
const closedCategory: LockedServiceCategory = { revision: 7, closedAt: PAST };

const cases = [
  {
    name: 'a completed row',
    row: job({ status: 'completed' }),
    category: openCategory,
    expected: 'noop',
  },
  {
    name: 'a failed row',
    row: job({ status: 'failed' }),
    category: openCategory,
    expected: 'noop',
  },
  {
    name: 'a row past its deadline',
    row: job({ deadlineAt: PAST }),
    category: openCategory,
    expected: 'SERVICE_CATEGORY_CLOSING_EXPIRED',
  },
  {
    name: 'a row exactly at its deadline',
    row: job({ deadlineAt: NOW }),
    category: openCategory,
    expected: 'SERVICE_CATEGORY_CLOSING_EXPIRED',
  },
  {
    name: 'a revision the manager no longer confirms',
    row: job({ expectedRevision: 8 }),
    category: openCategory,
    expected: 'SERVICE_CATEGORY_REVISION_CONFLICT',
  },
  {
    name: 'a category closed by someone else',
    row: job(),
    category: closedCategory,
    expected: 'SERVICE_CATEGORY_ALREADY_CLOSED',
  },
  {
    name: 'a category that is already open',
    row: job({ action: 'reopen' }),
    category: openCategory,
    expected: 'SERVICE_CATEGORY_NOT_CLOSED',
  },
  {
    name: 'a close the manager confirmed',
    row: job(),
    category: openCategory,
    expected: 'proceed',
  },
  {
    name: 'a reopen the manager confirmed',
    row: job({ action: 'reopen' }),
    category: closedCategory,
    expected: 'proceed',
  },
  {
    name: 'a finished row past its deadline',
    row: job({ status: 'completed', deadlineAt: PAST }),
    category: closedCategory,
    expected: 'noop',
  },
  {
    name: 'an expired row with a stale revision',
    row: job({ deadlineAt: PAST, expectedRevision: 8 }),
    category: openCategory,
    expected: 'SERVICE_CATEGORY_CLOSING_EXPIRED',
  },
  {
    name: 'a stale revision on a closed category',
    row: job({ expectedRevision: 8 }),
    category: closedCategory,
    expected: 'SERVICE_CATEGORY_REVISION_CONFLICT',
  },
  {
    name: 'a stale revision on an open category',
    row: job({ action: 'reopen', expectedRevision: 8 }),
    category: openCategory,
    expected: 'SERVICE_CATEGORY_REVISION_CONFLICT',
  },
];

it.each(cases)('decides $name as $expected', ({ row, category, expected }) => {
  expect(decideServiceCategoryClosing(row, category, NOW)).toBe(expected);
});

it.each([
  { expected: 301, locked: 301, decision: 'proceed' },
  { expected: 301, locked: 300, decision: 'SERVICE_CATEGORY_COUNT_CHANGED' },
  { expected: 301, locked: 302, decision: 'SERVICE_CATEGORY_COUNT_CHANGED' },
])(
  'decides a count of $locked against $expected as $decision',
  ({ expected, locked, decision }) => {
    expect(decideServiceCategoryClosingCount(expected, locked)).toBe(decision);
  },
);

it('carries the same failure codes as the contract', () => {
  expect([...SERVICE_CATEGORY_CLOSING_FAILURES]).toEqual([
    ...SERVICE_CATEGORY_CLOSING_FAILURE_CODES,
  ]);
});
