import { expect, it } from 'vitest';

import {
  decideServiceCategoryClosingPending,
  SERVICE_CATEGORY_SYNC_CLOSING_LIMIT,
  serviceCategoryClosingDeadline,
  serviceCategoryClosingPath,
  type PendingServiceCategoryClosing,
  type ServiceCategoryClosingIntent,
} from '../service-category-closing-path.ts';

const NOW = new Date('2026-11-14T10:00:00.000Z');
const CLOSING_ID = '01920000-0000-7000-8000-0000000000aa';
const DEADLINE = new Date('2026-11-14T10:15:00.000Z');

const intent: ServiceCategoryClosingIntent = {
  action: 'close',
  expected_revision: 4,
  expected_service_count: 301,
};

const pending = (
  overrides: Partial<PendingServiceCategoryClosing> = {},
): PendingServiceCategoryClosing => ({
  id: CLOSING_ID,
  action: 'close',
  expected_revision: 4,
  expected_service_count: 301,
  deadline_at: DEADLINE,
  ...overrides,
});

it('keeps the close synchronous up to 300 services and moves above it to the job', () => {
  expect(serviceCategoryClosingPath(SERVICE_CATEGORY_SYNC_CLOSING_LIMIT - 1)).toBe('sync');
  expect(serviceCategoryClosingPath(SERVICE_CATEGORY_SYNC_CLOSING_LIMIT)).toBe('sync');
  expect(serviceCategoryClosingPath(SERVICE_CATEGORY_SYNC_CLOSING_LIMIT + 1)).toBe('job');
  expect(SERVICE_CATEGORY_SYNC_CLOSING_LIMIT).toBe(300);
});

it('answers the same request with the same closing when nothing changed', () => {
  expect(decideServiceCategoryClosingPending(pending(), intent, NOW)).toEqual({
    kind: 'replay',
    closing_id: CLOSING_ID,
  });
});

it('has no pending request when the category carries none', () => {
  expect(decideServiceCategoryClosingPending(null, intent, NOW)).toEqual({ kind: 'none' });
});

it.each([
  ['another action', { ...intent, action: 'reopen' as const }],
  ['another revision', { ...intent, expected_revision: 5 }],
  ['another count', { ...intent, expected_service_count: 302 }],
])('refuses a request with %s while one is pending', (_case, changed) => {
  expect(decideServiceCategoryClosingPending(pending(), changed, NOW)).toEqual({
    kind: 'in_progress',
    closing_id: CLOSING_ID,
  });
});

it.each([
  ['before the deadline', DEADLINE.getTime() - 1, 'replay'],
  ['at the deadline', DEADLINE.getTime(), 'expired'],
  ['after the deadline', DEADLINE.getTime() + 1, 'expired'],
])('decides the pending request %s', (_case, at, kind) => {
  expect(decideServiceCategoryClosingPending(pending(), intent, new Date(at))).toEqual({
    kind,
    closing_id: CLOSING_ID,
  });
});

it('adds the allowed window to the requested moment for the deadline', () => {
  expect(serviceCategoryClosingDeadline(NOW, 900_000).toISOString()).toBe(
    '2026-11-14T10:15:00.000Z',
  );
});
