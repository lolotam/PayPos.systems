import { expect, it } from 'vitest';
import { employeeLeaveListQuery, leaveListQuery, ownLeaveListQuery } from '../staff/leave.js';

it('enables the employee open list only with the literal true query value', () => {
  expect(employeeLeaveListQuery.parse({ open: 'true' })).toEqual({ open: 'true', limit: 20 });
  for (const open of ['false', '1', true])
    expect(employeeLeaveListQuery.safeParse({ open }).success).toBe(false);
});

it('requires an ISO instant for the employee boundary', () => {
  expect(employeeLeaveListQuery.parse({ as_of: '2026-10-04T10:00:00Z' }).as_of).toBe(
    '2026-10-04T10:00:00Z',
  );
  for (const as_of of ['2026-10-04', 'invalid', '2026-10-04T10:00:00'])
    expect(employeeLeaveListQuery.safeParse({ as_of }).success).toBe(false);
});

it('keeps the common and personal list contracts closed to the new employee parameters', () => {
  for (const schema of [leaveListQuery, ownLeaveListQuery]) {
    expect(schema.parse({})).toEqual({ limit: 20 });
    for (const query of [{ open: 'true' }, { as_of: '2026-10-04T10:00:00Z' }])
      expect(schema.safeParse(query).success).toBe(false);
  }
});
