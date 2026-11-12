import { expect, it } from 'vitest';
import {
  defaultLeaveFilters,
  fromHistoryQuery,
  offeredAbsence,
  offeredHistoryStatuses,
  offeredHistoryTypes,
  toHistoryQuery,
  type LeaveHistoryFilters,
} from './leave-history-filters';

const branchId = '01920000-0000-7000-8000-000000000a01';

function filters(overrides: Partial<LeaveHistoryFilters> = {}): LeaveHistoryFilters {
  return {
    from: '2026-01-01',
    to: '2026-10-24',
    type: '',
    status: '',
    branchId: '',
    ...overrides,
  };
}

it.each([
  ['2026-10-24T09:00:00Z', 'Asia/Kuwait', '2026-01-01', '2026-10-24'],
  ['2026-12-31T22:30:00Z', 'Asia/Kuwait', '2027-01-01', '2027-01-01'],
  ['2026-12-31T23:30:00Z', 'UTC', '2026-01-01', '2026-12-31'],
])('defaults to 1 January through the local day at %s in %s', (instant, zone, from, to) => {
  expect(defaultLeaveFilters(new Date(instant), zone)).toEqual({
    ...filters({ from, to }),
  });
});

it('maps only selected filters and always uses the history page limit', () => {
  expect(toHistoryQuery(filters({ type: 'ANNUAL', status: 'APPROVED', branchId }))).toEqual({
    from: '2026-01-01',
    to: '2026-10-24',
    'types[]': ['ANNUAL'],
    'statuses[]': ['APPROVED'],
    branch_id: branchId,
    limit: 20,
  });
  expect(toHistoryQuery(filters())).toEqual({
    from: '2026-01-01',
    to: '2026-10-24',
    'types[]': [],
    'statuses[]': [],
    limit: 20,
  });
});

it('accepts exactly 366 days and rejects longer or reversed ranges', () => {
  expect(toHistoryQuery(filters({ from: '2026-01-01', to: '2027-01-01' }))).not.toBeNull();
  expect(toHistoryQuery(filters({ from: '2026-01-01', to: '2027-01-02' }))).toBeNull();
  expect(toHistoryQuery(filters({ from: '2026-10-25' }))).toBeNull();
});

it('round trips applied history filters into the form', () => {
  const query = toHistoryQuery(filters({ type: 'SICK', status: 'REJECTED', branchId }));
  expect(query).not.toBeNull();
  if (query) {
    expect(fromHistoryQuery(query)).toEqual(
      filters({ type: 'SICK', status: 'REJECTED', branchId }),
    );
  }
});

it('offers absence rows and filters only with an attendance-readable branch', () => {
  expect(offeredAbsence([])).toBe(false);
  expect(offeredAbsence([branchId])).toBe(true);
  expect(offeredHistoryTypes(false)).toEqual(['ANNUAL', 'SICK', 'UNPAID', 'OTHER']);
  expect(offeredHistoryTypes(true)).toContain('UNEXCUSED_ABSENCE');
  expect(offeredHistoryStatuses(false)).toEqual(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
  expect(offeredHistoryStatuses(true)).toContain('ABSENT');
});
