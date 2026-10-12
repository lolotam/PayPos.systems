import { expect, it } from 'vitest';
import { serviceSessionDayQuery, serviceSessionDayPage } from './service-session-day.js';

it('requires a real calendar date, bounds pagination and accepts only the late literal', () => {
  expect(serviceSessionDayQuery.parse({ date: '2024-02-29' })).toEqual({ date: '2024-02-29', limit: 20 });
  expect(serviceSessionDayQuery.parse({ date: '2026-10-14', late: 'true', limit: '100' }).limit).toBe(100);
  for (const bad of [{}, { date: '0000-01-01' }, { date: '2026-02-29' }, { date: '2026-04-31' }, { date: '2026-10-14', late: 'false' },
    { date: '2026-10-14', limit: 0 }, { date: '2026-10-14', limit: 101 }, { date: '2026-10-14', cursor: '*' },
    { date: '2026-10-14', employee_id: 'client-filter' }]) expect(serviceSessionDayQuery.safeParse(bad).success).toBe(false);
});
it('allows an empty strict page', () => {
  expect(serviceSessionDayPage.parse({ items: [], next_cursor: null })).toEqual({ items: [], next_cursor: null });
  expect(serviceSessionDayPage.safeParse({ items: [], next_cursor: null, phone: 'private' }).success).toBe(false);
});
